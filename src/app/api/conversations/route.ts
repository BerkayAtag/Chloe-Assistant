import { NextResponse } from 'next/server';
import { getAllConversations, createConversation } from '@/lib/db';

export async function GET() {
  try {
    const conversations = getAllConversations();
    return NextResponse.json({ success: true, data: conversations });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Bilinmeyen hata' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { title } = await req.json();
    const conversation = createConversation(title || 'Yeni Sohbet');
    return NextResponse.json({ success: true, data: conversation });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Bilinmeyen hata' }, { status: 500 });
  }
}
