import {
  updateProject,
  deleteProject,
  renameFolder,
  moveFolder,
  deleteFolder,
} from '@/lib/projects';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { type, name, projectId, parentId, description } = body;

    if (type === 'project') {
      const project = updateProject(id, { name, description });
      if (!project) return Response.json({ error: 'Proje bulunamadı.' }, { status: 404 });
      return Response.json({ success: true, data: project });
    }

    // type === 'folder'
    if (name !== undefined) {
      const folder = renameFolder(id, name);
      if (!folder) return Response.json({ error: 'Klasör bulunamadı.' }, { status: 404 });
      return Response.json({ success: true, data: folder });
    }
    if (projectId !== undefined) {
      const moved = moveFolder(id, projectId, parentId ?? null);
      if (!moved) {
        return Response.json(
          { error: 'Klasör taşınamadı (kendi altına taşınamaz).' },
          { status: 400 }
        );
      }
      return Response.json({ success: true });
    }
    return Response.json({ error: 'Geçersiz istek.' }, { status: 400 });
  } catch (error: unknown) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Bilinmeyen hata' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { type } = await req.json();

    const removed = type === 'folder' ? deleteFolder(id) : deleteProject(id);
    if (!removed) return Response.json({ error: 'Kayıt bulunamadı.' }, { status: 404 });
    return Response.json({ success: true });
  } catch (error: unknown) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Bilinmeyen hata' },
      { status: 500 }
    );
  }
}
