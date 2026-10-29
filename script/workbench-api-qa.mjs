import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

let base = process.env.CHLOE_TEST_URL;
let spawnedServer = null;
let tmpMemoryDir = null;

if (!base) {
  tmpMemoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chloe-workbench-qa.'));
  process.env.CHLOE_MEMORY_DIR = tmpMemoryDir;
  const testPort = 3918;
  base = `http://127.0.0.1:${testPort}`;
  // Start Next directly: npm is a .cmd shim on Windows that spawn() cannot run without a shell.
  spawnedServer = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(testPort)], {
    env: { ...process.env, CHLOE_MEMORY_DIR: tmpMemoryDir, PORT: String(testPort) },
    stdio: 'ignore'
  });
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const res = await fetch(`${base}/api/identity`);
      if ([200, 400, 403].includes(res.status)) break;
    } catch {}
  }
}

assert.ok(base && process.env.CHLOE_MEMORY_DIR?.startsWith(path.join(os.tmpdir(), 'chloe-workbench-qa.')), 'An isolated test server is required.');
let count = 0; const check = (label, value) => { assert.ok(value, label); console.log('PASS', label); count++; };
const headers = { 'Content-Type': 'application/json', Origin: base, 'X-Chloe-Client': 'workbench' };
async function api(body, extra = {}) { const r = await fetch(base + '/api/office/workbench', { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body), signal: AbortSignal.timeout(40000) }); return { status: r.status, ...await r.json() }; }
let received = [];
const model = http.createServer(async (req,res) => {
  let raw=''; for await (const chunk of req) raw+=chunk;
  const body=JSON.parse(raw); received.push({ model: body.model, key: req.headers.authorization, url: req.url });
  if (req.url.endsWith('/audio/speech')) { res.writeHead(200, {'Content-Type':'audio/wav'}); const audio=Buffer.alloc(46); audio.write('RIFF'); audio.writeUInt32LE(38,4); audio.write('WAVEfmt ',8); audio.writeUInt32LE(16,16); audio.writeUInt16LE(1,20); audio.writeUInt16LE(1,22); audio.writeUInt32LE(24000,24); audio.writeUInt32LE(48000,28); audio.writeUInt16LE(2,32); audio.writeUInt16LE(16,34); audio.write('data',36); audio.writeUInt32LE(2,40); res.end(audio); return; }
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({ id:'qa',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message:{role:'assistant',content:'QA çıkarımı: Kaydedilen örnek bilgi. Bu bir çıkarımdır.'},finish_reason:'stop'}],usage:{prompt_tokens:5,completion_tokens:8,total_tokens:13} }));
});
await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
const settings={ provider:'cloud',cloudProvider:'custom',apiKey:'qa-workbench-key',apiBaseUrl:`http://127.0.0.1:${model.address().port}/v1`,cloudModel:'qa-workbench-model',customModel:'qa-workbench-model',customSpeechModel:'qa-speech-model',customProviderName:'QA',customSupportsTools:false,savedCustomProviders:[],selectedCustomProviderId:'' };
const root=await fs.mkdtemp(path.join(os.tmpdir(),'chloe-workbench-project-'));
try {
  check('workbench rejects foreign origin', (await api({action:'recall',query:'',scope:''},{Origin:'https://foreign.example'})).status===403);
  check('workbench requires application header', (await api({action:'recall',query:'',scope:''},{'X-Chloe-Client':''})).status===403);
  const broken=await fetch(base+'/api/office/workbench',{method:'POST',headers,body:'{bad'}); check('malformed JSON rejected',broken.status===400);
  check('isolated bank starts empty',(await api({action:'recall',query:'',scope:''})).records.length===0);
  const first=await api({action:'retain',record:{title:'QA örnek',text:'Örnek proje TypeScript kullanır.',kind:'fact',scope:'',sources:['https://example.com']}});
  check('memory retained',first.status===200 && !!first.record.id);
  check('memory recalled',(await api({action:'recall',query:'TypeScript',scope:''})).records[0].id===first.record.id);
  const updated=await api({action:'retain',record:{title:'QA düzeltme',text:'Örnek proje Swift kullanır.',kind:'fact',scope:'',sources:[],replaces:first.record.id}});
  check('correction archives original',updated.status===200 && (await api({action:'recall',query:'',scope:'',includeArchived:true})).records.length===2);
  check('old correction cannot be revived over active replacement',(await api({action:'archive',id:first.record.id,archived:false})).status===400);
  await api({action:'archive',id:updated.record.id,archived:true});
  check('original can be restored after replacement archived',(await api({action:'archive',id:first.record.id,archived:false})).status===200);
  check('reflect requires explicit selected connection',(await api({action:'reflect',query:'TypeScript',scope:''})).status===400);
  const reflected=await api({action:'reflect',query:'TypeScript',scope:'',settings});
  check('reflect uses selected model and key',reflected.status===200 && reflected.kind==='reflection' && received.at(-1).model==='qa-workbench-model' && received.at(-1).key==='Bearer qa-workbench-key');
  check('reflection is not silently saved',(await api({action:'recall',query:'',scope:'',includeArchived:true})).records.length===2);
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({scripts:{test:'echo do not execute'},dependencies:{example:'1.0'}}));
  const inventory=await api({action:'analyze',workspace:root}); check('local inventory reaches HTTP UI API',inventory.status===200 && inventory.fileCount===1 && inventory.markdown.includes('example'));
  check('invalid project path rejected',(await api({action:'analyze',workspace:'/'})).status===400);
  check('crawler rejects private network',(await api({action:'crawl',url:'https://127.0.0.1',limit:1})).status===400);
  check('crawler rejects credential URLs',(await api({action:'crawl',url:'https://user:secret@example.com',limit:1})).status===400);
  const voice=await fetch(base+'/api/voice',{method:'POST',headers,body:JSON.stringify({text:'QA ses',settings})});
  check('voice returns real binary through selected custom endpoint',voice.status===200 && voice.headers.get('content-type')==='audio/wav' && (await voice.arrayBuffer()).byteLength===46 && received.at(-1).model==='qa-speech-model');
} finally {
  model.closeAllConnections();
  await new Promise(resolve=>model.close(resolve));
  await fs.rm(root,{recursive:true});
  if (spawnedServer) {
    spawnedServer.kill('SIGTERM');
  }
  if (tmpMemoryDir) {
    await fs.rm(tmpMemoryDir, { recursive: true, force: true });
  }
}
console.log(`TOTAL ${count} passed.`);
