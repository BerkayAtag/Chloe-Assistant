import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { dataDirectory } from './data-dir.ts';

const DATA_DIR = dataDirectory();
const PROJECTS_FILE = join(DATA_DIR, 'projects.json');

/**
 * Yeni hiyerarşi:
 * - Proje en üstte yer alır (ör. "Web Sitesi").
 * - Klasörler bir PROJE'nin altındadır ve kendi içlerinde iç içe olabilir.
 * - `parentId` klasörün üst klasörünü, `projectId` klasörün ait olduğu projeyi gösterir.
 */
export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFolder {
  id: string;
  name: string;
  /** Ait olduğu proje (zorunlu) */
  projectId: string;
  /** Üst klasör; null → projenin kökü */
  parentId: string | null;
  createdAt: string;
}

export interface ProjectsData {
  projects: Project[];
  folders: ProjectFolder[];
}

function ensureFile() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(PROJECTS_FILE)) {
    writeFileSync(
      PROJECTS_FILE,
      JSON.stringify({ projects: [], folders: [] }, null, 2),
      'utf-8'
    );
  }
}

function read(): ProjectsData {
  ensureFile();
  try {
    const parsed = JSON.parse(readFileSync(PROJECTS_FILE, 'utf-8'));
    if (!parsed || !Array.isArray(parsed.projects) || !Array.isArray(parsed.folders)) {
      throw new Error('Invalid projects data');
    }
    return {
      projects: parsed.projects || [],
      folders: parsed.folders || [],
    };
  } catch {
    throw new Error('Proje verisi okunamadı. Mevcut dosya korundu; veri dosyasını kontrol et.');
  }
}

function write(data: ProjectsData) {
  ensureFile();
  writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function listProjects(): ProjectsData {
  return read();
}

// ── Projeler ───────────────────────────────────────────

export function createProject(name: string, description = ''): Project {
  const data = read();
  const now = new Date().toISOString();
  const project: Project = {
    id: generateId(),
    name: (name || 'Yeni Proje').trim(),
    description: (description || '').trim(),
    createdAt: now,
    updatedAt: now,
  };
  data.projects.push(project);
  write(data);
  return project;
}

export function updateProject(
  id: string,
  patch: { name?: string; description?: string }
): Project | null {
  const data = read();
  const project = data.projects.find((p) => p.id === id);
  if (!project) return null;
  if (typeof patch.name === 'string' && patch.name.trim()) project.name = patch.name.trim();
  if (typeof patch.description === 'string') project.description = patch.description.trim();
  project.updatedAt = new Date().toISOString();
  write(data);
  return project;
}

export function deleteProject(id: string): boolean {
  const data = read();
  if (!data.projects.some((p) => p.id === id)) return false;
  data.projects = data.projects.filter((p) => p.id !== id);
  // Projenin tüm klasörleri de silinir
  data.folders = data.folders.filter((f) => f.projectId !== id);
  write(data);
  return true;
}

// ── Klasörler ──────────────────────────────────────────

export function createFolder(
  name: string,
  projectId: string,
  parentId: string | null = null
): ProjectFolder {
  const data = read();
  if (!data.projects.some((project) => project.id === projectId)) throw new Error('Proje bulunamadı.');
  if (parentId && !data.folders.some((folder) => folder.id === parentId && folder.projectId === projectId)) {
    throw new Error('Üst klasör aynı projede bulunmalı.');
  }
  const folder: ProjectFolder = {
    id: generateId(),
    name: (name || 'Yeni Klasör').trim(),
    projectId,
    parentId: parentId || null,
    createdAt: new Date().toISOString(),
  };
  data.folders.push(folder);
  write(data);
  return folder;
}

export function renameFolder(id: string, name: string): ProjectFolder | null {
  const data = read();
  const folder = data.folders.find((f) => f.id === id);
  if (!folder) return null;
  folder.name = (name || folder.name).trim();
  write(data);
  return folder;
}

/** Alt klasörleri toplar (döngü kontrolü için). */
function collectDescendants(id: string, folders: ProjectFolder[]): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Klasörü başka bir projeye veya aynı projede başka bir üst klasöre taşır. */
export function moveFolder(
  id: string,
  projectId: string,
  parentId: string | null
): boolean {
  const data = read();
  const folder = data.folders.find((f) => f.id === id);
  if (!folder || !data.projects.some((p) => p.id === projectId)) return false;
  if (parentId && !data.folders.some((f) => f.id === parentId && f.projectId === projectId)) return false;
  // Kendi altına taşınamaz
  if (parentId && collectDescendants(id, data.folders).has(parentId)) return false;
  // Aynı proje içinde kalmalı; alt klasörler de birlikte taşınır
  const doomed = collectDescendants(id, data.folders);
  for (const f of data.folders) {
    if (doomed.has(f.id)) f.projectId = projectId;
  }
  folder.projectId = projectId;
  folder.parentId = parentId || null;
  write(data);
  return true;
}

export function deleteFolder(id: string): boolean {
  const data = read();
  if (!data.folders.some((f) => f.id === id)) return false;
  const doomed = collectDescendants(id, data.folders);
  data.folders = data.folders.filter((f) => !doomed.has(f.id));
  write(data);
  return true;
}
