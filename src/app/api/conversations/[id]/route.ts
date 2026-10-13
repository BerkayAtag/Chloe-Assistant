import { getConversation, renameConversation, deleteConversation } from '@/lib/db';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const conversation = getConversation(id);

    if (!conversation) {
      return Response.json({ error: 'Conversation not found' }, { status: 404 });
    }

    return Response.json({ success: true, data: conversation });
  } catch (error: unknown) {
    return Response.json({ error: error instanceof Error ? error.message : 'Bilinmeyen hata' }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { title } = await req.json();
    const conversation = renameConversation(id, title);
    if (!conversation) {
      return Response.json({ error: 'Conversation not found' }, { status: 404 });
    }
    return Response.json({ success: true, data: conversation });
  } catch (error: unknown) {
    return Response.json({ error: error instanceof Error ? error.message : 'Bilinmeyen hata' }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const removed = deleteConversation(id);
    if (!removed) {
      return Response.json({ error: 'Conversation not found' }, { status: 404 });
    }
    return Response.json({ success: true });
  } catch (error: unknown) {
    return Response.json({ error: error instanceof Error ? error.message : 'Bilinmeyen hata' }, { status: 500 });
  }
}
