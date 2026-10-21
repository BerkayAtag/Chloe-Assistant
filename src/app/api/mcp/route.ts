import { NextResponse } from 'next/server';
import { localRequestAllowed } from '@/lib/request-origin';
import { getMCPClient, initializeMCP, loadMCPConfig } from '@/lib/mcp-client';

export const maxDuration = 10;

export async function GET(request: Request) {
  if (!localRequestAllowed(request)) return NextResponse.json({ error: 'Yerel Chloe isteği gerekli.' }, { status: 403 });
  try {
    const client = getMCPClient();
    const servers = client.getServers();
    const hasConnected = client.hasConnectedServers();
    const config = loadMCPConfig();
    return NextResponse.json({
      servers,
      hasConnected,
      configured: Object.keys(config),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Bilinmeyen hata' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!localRequestAllowed(request)) return NextResponse.json({ error: 'Yerel Chloe isteği gerekli.' }, { status: 403 });
  try {
    await initializeMCP();
    const client = getMCPClient();
    const servers = client.getServers();
    return NextResponse.json({ message: 'MCP sunucularına bağlanıldı', servers }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'MCP bağlantısı başarısız' }, { status: 500 });
  }
}