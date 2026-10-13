import { NextResponse } from 'next/server';
import { searchWeb } from '@/lib/search';

export async function POST(req: Request) {
  try {
    const { query, limit } = await req.json();
    if (!query) return NextResponse.json({ error: 'query gerekli.' }, { status: 400 });
    const results = await searchWeb(query, limit || 5);
    return NextResponse.json({ success: true, results });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Bilinmeyen hata' }, { status: 500 });
  }
}
