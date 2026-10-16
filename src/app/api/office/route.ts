import { after, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { officeAgents, officeRuns, removeOfficeRun, saveOfficeAgents } from '@/lib/office-store';
import { applyOfficeArtifact, cancelOfficeRun, createOfficeRun, executeOfficeRun, reconcileOfficeRuns, settingsForAgent } from '@/lib/office-engine';
import { DEFAULT_SETTINGS, hasExplicitConnection, type Settings } from '@/lib/settings';
import { getProvider } from '@/lib/llm-provider';
import { modelErrorMessage, modelSecrets } from '@/lib/model-error';
import { localRequestAllowed } from '@/lib/request-origin';
import { thinkingOptions, thinkingOutputTokenLimit } from '@/lib/thinking-options';
export const maxDuration = 300;
export async function GET(request: Request) {
  if (!localRequestAllowed(request)) return NextResponse.json({ error: 'Ofis yalnızca yerel Chloe uygulamasından okunabilir.' }, { status: 403 });
  try { return NextResponse.json({ agents: officeAgents(), runs: reconcileOfficeRuns() }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: 'Ajan ofisi verileri okunamadı.' }, { status: 500 }); }
}
export async function POST(request: Request) {
  let settings: Settings = DEFAULT_SETTINGS;
  try {
    if (!localRequestAllowed(request)) return NextResponse.json({ error: 'Bu istek bu uygulamadan yapılmalı.' }, { status: 403 });
    const body = await request.json(); settings = { ...DEFAULT_SETTINGS, ...body.settings };
    switch (body.action) {
      case 'saveAgents': return NextResponse.json({ agents: saveOfficeAgents(body.agents) });
      case 'start': {
        if (typeof body.prompt !== 'string' || typeof body.workspace !== 'string') throw new Error('Görev ve klasör alanları geçersiz.');
        if (officeAgents().some((agent) => agent.enabled && agent.provider === 'inherit') && !hasExplicitConnection(body.settings)) throw new Error('Sohbet ayarlarını kullanan ajanlar için etkin AI bağlantısı gerekli. Varsayılan sağlayıcıya geçilmedi.');
        if (body.focusFile !== undefined && (typeof body.focusFile !== 'string' || typeof body.expectedHash !== 'string')) throw new Error('Codex dosya bağlamı geçersiz.');
        const run = createOfficeRun(body.prompt, body.workspace, body.focusFile, body.expectedHash);
        after(() => executeOfficeRun(run, settings, body.webSearch !== false));
        return NextResponse.json({ run }, { status: 202 });
      }
      case 'cancel': cancelOfficeRun(body.id); return NextResponse.json({ success: true });
      case 'delete': {
        const run = officeRuns().find((r) => r.id === body.id);
        if (run && ['planning', 'running'].includes(run.status)) throw new Error('Önce çalışmayı durdur.');
        removeOfficeRun(body.id); return NextResponse.json({ success: true });
      }
      case 'apply': return NextResponse.json({ artifact: applyOfficeArtifact(body.id, body.artifactId) });
      case 'testAgent': {
        const agent = officeAgents(true).find((a) => a.id === body.id); if (!agent) throw new Error('Ajan bulunamadı.');
        if (agent.provider === 'inherit' && !hasExplicitConnection(body.settings)) throw new Error('Bu ajan için etkin sohbet bağlantısı gerekli. Varsayılan sağlayıcıya geçilmedi.');
        const s = settingsForAgent(agent, settings);
        const result = await generateText({ model: getProvider(s), prompt: 'Sadece OK yaz.', maxOutputTokens: thinkingOutputTokenLimit(s, 512), maxRetries: 0, abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]), providerOptions: thinkingOptions(s) });
        if (!result.text.trim()) throw new Error('Ajan boş yanıt verdi.');
        return NextResponse.json({ response: result.text });
      }
      default: throw new Error('Geçersiz ofis işlemi.');
    }
  } catch (error) {
    const secrets = modelSecrets(settings);
    try { secrets.push(...officeAgents(true).map((a) => a.apiKey || '')); } catch { /* Preserve the original error if the store is unavailable. */ }
    return NextResponse.json({ error: modelErrorMessage(error, secrets) }, { status: 400 });
  }
}
