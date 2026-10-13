import { NextResponse } from 'next/server';
import { searchMemory } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const { query } = await req.json();
    const results = searchMemory(query);
    return NextResponse.json({ success: true, data: results });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Bilinmeyen hata' }, { status: 500 });
  }
}
