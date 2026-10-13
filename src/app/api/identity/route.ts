import { NextResponse } from 'next/server';
import { getIdentity, updateIdentity } from '@/lib/identity';

export async function GET() {
  try {
    return NextResponse.json({ success: true, data: getIdentity() });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Bilinmeyen hata' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { assistantName, userName } = await req.json();
    const identity = updateIdentity({ assistantName, userName });
    return NextResponse.json({ success: true, data: identity });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Bilinmeyen hata' }, { status: 500 });
  }
}
