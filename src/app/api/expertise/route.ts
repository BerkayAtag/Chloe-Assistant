import { NextResponse } from 'next/server';
import { listExpertise, removeExpertise } from '@/lib/knowledge';

export async function GET() {
  try {
    return NextResponse.json({ success: true, data: listExpertise() });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Bilinmeyen hata' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();
    const removed = removeExpertise(id);
    return NextResponse.json({ success: true, removed });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Bilinmeyen hata' }, { status: 500 });
  }
}
