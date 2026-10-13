import { listProjects, createProject, createFolder } from '@/lib/projects';

export async function GET() {
  try {
    return Response.json({ success: true, data: listProjects() });
  } catch (error: unknown) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Bilinmeyen hata' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const { type, name, projectId, parentId, description } = await req.json();
    if (!['project', 'folder'].includes(type) || typeof name !== 'string' || !name.trim() ||
        (description !== undefined && typeof description !== 'string')) {
      return Response.json({ error: 'Geçerli bir proje/klasör türü ve boş olmayan bir ad gerekli.' }, { status: 400 });
    }

    if (type === 'project') {
      const project = createProject(name, description);
      return Response.json({ success: true, data: project });
    }

    // type === 'folder'
    if (typeof projectId !== 'string' || !projectId || (parentId != null && typeof parentId !== 'string')) {
      return Response.json({ error: 'Klasör için projectId gerekli.' }, { status: 400 });
    }
    let folder;
    try { folder = createFolder(name, projectId, parentId || null); } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'Klasör oluşturulamadı.' }, { status: 400 });
    }
    return Response.json({ success: true, data: folder });
  } catch (error: unknown) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Bilinmeyen hata' },
      { status: 500 }
    );
  }
}
