import { NextResponse } from 'next/server';
import {
  integrationRequestAllowed,
  integrationStatus,
  isIntegrationProvider,
  removeIntegration,
} from '@/lib/jarvis-integrations';

export async function DELETE(
  request: Request,
  context: { params: Promise<{ provider: string }> }
) {
  if (!integrationRequestAllowed(request)) {
    return NextResponse.json({ error: 'Hesap bağlantılarına yalnızca yerel Chloe uygulamasından erişilebilir.' }, { status: 403 });
  }
  const { provider } = await context.params;
  if (!isIntegrationProvider(provider)) {
    return NextResponse.json({ error: 'Bu bağlantı sağlayıcısı desteklenmiyor.' }, { status: 404 });
  }
  try {
    removeIntegration(provider);
    return NextResponse.json({ success: true, integration: integrationStatus(provider) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Bağlantı kaldırılamadı.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
