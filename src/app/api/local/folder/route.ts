import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { NextResponse } from 'next/server';
import { localRequestAllowed } from '@/lib/request-origin';

export const maxDuration = 300;

// The macOS app picks folders through its WebKit bridge. In the Windows
// build the page runs in a normal browser window, so the local server opens
// the system folder dialog on the same desktop instead.
const DIALOG_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  '$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; Opacity = 0 }',
  '$owner.Show(); $owner.Activate()',
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
  "$dialog.Description = 'Chloe için proje klasörünü seç'",
  '$dialog.ShowNewFolderButton = $true',
  "if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }",
  '$owner.Close()',
].join('\n');

let dialogOpen = false;

export async function POST(request: Request) {
  if (!localRequestAllowed(request) || request.headers.get('x-chloe-client') !== 'workspace') {
    return NextResponse.json({ error: 'Klasör seçimi yalnızca Chloe içinden yapılabilir.' }, { status: 403 });
  }
  if (process.platform !== 'win32') return NextResponse.json({ error: 'Bu klasör penceresi yalnız Windows sürümünde kullanılır.' }, { status: 501 });
  if (dialogOpen) return NextResponse.json({ error: 'Klasör seçme penceresi zaten açık.' }, { status: 409 });

  dialogOpen = true;
  try {
    const selected = await new Promise<string>((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', Buffer.from(DIALOG_SCRIPT, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      const chunks: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      const timer = setTimeout(() => child.kill(), 290_000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('utf8').trim()); });
    });
    if (!selected) return NextResponse.json({ path: '' });
    if (!fs.statSync(selected, { throwIfNoEntry: false })?.isDirectory()) {
      return NextResponse.json({ error: 'Seçilen klasör bulunamadı.' }, { status: 404 });
    }
    return NextResponse.json({ path: selected });
  } catch {
    return NextResponse.json({ error: 'Windows klasör seçme penceresi açılamadı.' }, { status: 500 });
  } finally {
    dialogOpen = false;
  }
}
