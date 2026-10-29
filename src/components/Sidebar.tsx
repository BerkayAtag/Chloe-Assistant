'use client';
import {
  Plus,
  MessageSquare,
  Folder,
  FolderOpen,
  FolderPlus,
  FileText,
  Settings,
  Menu,
  Sun,
  Moon,
  BookOpen,
  Trash2,
  Pencil,
  Search,
  ChevronRight,
  ChevronDown,
  Brain,
  Circle,
  Users,
} from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import type { Theme } from '@/lib/settings';

interface Expertise {
  id: string;
  topic: string;
  summary: string;
}

interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

interface ProjectFolder {
  id: string;
  name: string;
  projectId: string;
  parentId: string | null;
  createdAt: string;
}

interface ConversationMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

type Tab = 'projects' | 'chats';

export default function Sidebar({
  onOpenOffice,
  onNewChat,
  onSettingsClick,
  onSelectConversation,
  onConversationDeleted,
  activeId,
  theme,
  onToggleTheme,
}: {
  onOpenOffice: () => void;
  onNewChat: () => void;
  onSettingsClick: () => void;
  onSelectConversation: (id: string) => void;
  onConversationDeleted: (id: string) => void;
  activeId: string | null;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  // Mobilde yan panel başlangıçta kapalı olmalı; aksi halde panel mesaj alanının
  // üstüne oturup alttaki composer düğmelerinin tıklanmasını engeller.
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('chats');

  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [conversationFilter, setConversationFilter] = useState('');
  const [expertise, setExpertise] = useState<Expertise[]>([]);

  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations');
      const data = await res.json();
      if (data.success) setConversations(data.data);
    } catch {}
  }, []);

  const fetchExpertise = useCallback(async () => {
    try {
      const res = await fetch('/api/expertise');
      const data = await res.json();
      if (data.success) setExpertise(data.data);
    } catch {}
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      if (data.success) {
        setProjects(data.data.projects || []);
        setFolders(data.data.folders || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    // Aşağıdaki çağrılar async'tir: setState yalnızca await sonrası callback'lerde
    // çalışır; statik analiz bunu göremediği için kural bu satırlarda kapatılır.
    /* eslint-disable react-hooks/set-state-in-effect */
    fetchConversations();
    fetchExpertise();
    fetchProjects();
    /* eslint-enable react-hooks/set-state-in-effect */
    window.addEventListener('refreshConversations', fetchConversations);
    window.addEventListener('refreshExpertise', fetchExpertise);
    window.addEventListener('refreshProjects', fetchProjects);
    return () => {
      window.removeEventListener('refreshConversations', fetchConversations);
      window.removeEventListener('refreshExpertise', fetchExpertise);
      window.removeEventListener('refreshProjects', fetchProjects);
    };
  }, [fetchConversations, fetchExpertise, fetchProjects]);

  const removeExpertise = async (id: string) => {
    try {
      await fetch('/api/expertise', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      fetchExpertise();
    } catch {}
  };

  // ── Projeler ─────────────────────────────────────────────

  const createProject = async () => {
    const name = window.prompt('Proje adı:');
    if (!name?.trim()) return;
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'project', name }),
    });
    fetchProjects();
  };

  const renameProject = async (id: string, current: string) => {
    const name = window.prompt('Yeni proje adı:', current);
    if (!name?.trim()) return;
    await fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'project', name }),
    });
    fetchProjects();
  };

  const deleteProject = async (id: string, name: string) => {
    if (!window.confirm(`"${name}" projesi ve içindeki tüm klasörler silinsin mi?`)) return;
    await fetch(`/api/projects/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'project' }),
    });
    fetchProjects();
  };

  const createFolder = async (projectId: string, parentId: string | null) => {
    const name = window.prompt('Klasör adı:');
    if (!name?.trim()) return;
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'folder', name, projectId, parentId }),
    });
    if (parentId) setExpanded((p) => new Set(p).add(parentId));
    fetchProjects();
  };

  const renameFolder = async (id: string, current: string) => {
    const name = window.prompt('Yeni klasör adı:', current);
    if (!name?.trim()) return;
    await fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'folder', name }),
    });
    fetchProjects();
  };

  const moveFolderToProject = async (id: string, projectId: string) => {
    await fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'folder', projectId, parentId: null }),
    });
    fetchProjects();
  };

  const deleteFolder = async (id: string, name: string) => {
    if (!window.confirm(`"${name}" klasörü silinsin mi?`)) return;
    await fetch(`/api/projects/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'folder' }),
    });
    fetchProjects();
  };

  const toggleFolder = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Konuşmalar ──────────────────────────────────────────

  const deleteConversation = async (id: string, title: string) => {
    if (!window.confirm(`"${title}" konuşması silinsin mi?`)) return;
    try {
      await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      onConversationDeleted(id);
      fetchConversations();
    } catch {}
  };

  const renameConversation = async (id: string, current: string) => {
    const title = window.prompt('Yeni başlık:', current);
    if (!title?.trim()) return;
    try {
      await fetch(`/api/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      fetchConversations();
    } catch {}
  };

  // ── Ağaç yardımcıları ───────────────────────────────────

  const rootFoldersOf = (projectId: string) =>
    folders.filter((f) => f.projectId === projectId && !f.parentId);
  const childrenOf = (parentId: string) =>
    folders.filter((f) => f.parentId === parentId);
  const moveSelect = (folder: ProjectFolder) => (
    <select
      value={folder.projectId}
      onChange={(e) => moveFolderToProject(folder.id, e.target.value)}
      onClick={(e) => e.stopPropagation()}
      className="bg-white dark:bg-night-800 border border-gray-300 dark:border-night-700 text-[11px] text-gray-900 dark:text-gray-200 rounded px-1 py-0.5 outline-none max-w-[110px]"
      title="Klasörü başka projeye taşı"
    >
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );

  const filteredConversations = conversations.filter((c) =>
    (c.title || '').toLowerCase().includes(conversationFilter.toLowerCase())
  );

  const themeNext: Record<Theme, Theme> = { dark: 'black', black: 'light', light: 'dark' };
  const themeLabel: Record<Theme, string> = {
    dark: 'Karanlık Tema',
    black: 'Siyah Tema',
    light: 'Beyaz Tema',
  };

  // ── Render ──────────────────────────────────────────────

  return (
    <>
      <button
        type="button"
        aria-label={isOpen ? 'Menüyü kapat' : 'Menüyü aç'}
        aria-expanded={isOpen}
        className="md:hidden fixed top-4 left-4 z-50 p-2 bg-night-800 text-white rounded-md border border-night-700"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Menu />
      </button>

      <div
        className={`fixed md:static inset-y-0 left-0 z-40 w-72 bg-white dark:bg-night-900 border-r border-gray-200 dark:border-night-750 flex flex-col transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="p-4 pt-18 md:pt-4 pb-3">
          <button
            onClick={() => { onNewChat(); setIsOpen(false); }}
            className="w-full flex items-center gap-2 bg-app-accent hover:opacity-90 text-app-on-accent py-3 px-4 rounded-lg transition-colors shadow-lg shadow-app-accent/30 font-medium"
          >
            <Plus size={18} />
            <span>Yeni Sohbet</span>
          </button>
          <button onClick={() => { onOpenOffice(); setIsOpen(false); }} className="mt-3 flex w-full items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-600 transition hover:bg-gray-100 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"><Users size={18}/> Ajan Ofisi</button>
        </div>

        {/* Sekmeler */}
        <div className="px-4 pb-2">
          <div className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400 dark:text-gray-600">
            Çalışma alanı
          </div>
          <div className="flex bg-gray-100 dark:bg-night-850 rounded-lg p-1 border border-gray-200 dark:border-night-750">
            <button
              onClick={() => setTab('projects')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === 'projects'
                  ? 'bg-white dark:bg-night-700 text-gray-900 dark:text-white shadow'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              <Folder size={14} />
              Projeler
            </button>
            <button
              onClick={() => setTab('chats')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === 'chats'
                  ? 'bg-white dark:bg-night-700 text-gray-900 dark:text-white shadow'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              <MessageSquare size={14} />
              Konuşmalar
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 space-y-6 mt-2 custom-scrollbar">
          {tab === 'projects' ? (
            <div>
              <p className="px-2 mb-3 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
                Projeler dosya ve klasör düzeni içindir. Konuşmalar ayrı alanda tutulur.
              </p>
              <button
                onClick={createProject}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-gray-300 dark:border-night-700 text-xs font-medium text-gray-700 dark:text-gray-300 hover:border-app-accent dark:hover:border-app-accent/60 transition-colors mb-3"
              >
                <Plus size={14} /> Yeni Proje
              </button>

              <div className="space-y-1.5">
                {projects.map((project) => {
                  const isOpen = expanded.has(project.id);
                  const rootFolders = rootFoldersOf(project.id);
                  return (
                    <div key={project.id}>
                      {/* Proje satırı */}
                      <div
                        className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm transition-colors cursor-pointer ${
                          isOpen
                            ? 'bg-gray-100 dark:bg-night-800 text-gray-900 dark:text-white'
                            : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-night-800'
                        }`}
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(project.id)) next.delete(project.id);
                            else next.add(project.id);
                            return next;
                          })
                        }
                      >
                        {isOpen ? (
                          <ChevronDown size={14} className="text-gray-400 shrink-0" />
                        ) : (
                          <ChevronRight size={14} className="text-gray-400 shrink-0" />
                        )}
                        <FileText size={15} className="text-app-accent shrink-0" />
                        <span className="truncate flex-1 font-medium" title={project.description || project.name}>
                          {project.name}
                        </span>
                        <span
                          className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => createFolder(project.id, null)}
                            className="text-gray-400 hover:text-app-accent"
                            aria-label="Projeye klasör ekle"
                            title="Projeye klasör ekle"
                          >
                            <FolderPlus size={13} />
                          </button>
                          <button
                            onClick={() => renameProject(project.id, project.name)}
                            className="text-gray-400 hover:text-app-accent"
                            aria-label="Yeniden adlandır"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={() => deleteProject(project.id, project.name)}
                            className="text-gray-400 hover:text-red-400"
                            aria-label="Sil"
                          >
                            <Trash2 size={12} />
                          </button>
                        </span>
                      </div>

                      {/* Projenin klasörleri */}
                      {isOpen && (
                        <div className="mt-0.5">
                          {rootFolders.map((f) => (
                            <FolderNode
                              key={f.id}
                              folder={f}
                              depth={0}
                              folders={folders}
                              expanded={expanded}
                              onToggle={toggleFolder}
                              onRename={renameFolder}
                              onDelete={deleteFolder}
                              onCreateSubfolder={createFolder}
                              moveSelect={moveSelect}
                              childrenOf={childrenOf}
                            />
                          ))}
                          {rootFolders.length === 0 && (
                            <div className="text-[11px] text-gray-400 dark:text-gray-500 pl-8 py-1">
                              Klasör yok — üzerine gelip 📁 ile ekle.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {projects.length === 0 && (
                  <div className="text-xs text-gray-400 dark:text-gray-500 px-2 py-2">
                    Henüz proje yok. &quot;Yeni Proje&quot; ile oluştur; klasörleri
                    projenin içinde düzenleyebilirsin.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              <p className="px-2 mb-3 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
                Konuşmalar projelerden bağımsızdır; araştırmalar ve hafıza burada görünür.
              </p>
              {/* Konuşma arama */}
              <div className="relative px-1 mb-3">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={conversationFilter}
                  onChange={(e) => setConversationFilter(e.target.value)}
                  placeholder="Konuşmalarda ara..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-gray-100 dark:bg-night-850 border border-gray-200 dark:border-night-750 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-app-accent/60"
                />
              </div>

              <div className="space-y-0.5">
                {filteredConversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`group flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                      activeId === conv.id
                        ? 'bg-gray-200 dark:bg-night-700 text-gray-900 dark:text-white'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-night-800'
                    }`}
                  >
                    <button
                      onClick={() => {
                        onSelectConversation(conv.id);
                        setIsOpen(false);
                      }}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    >
                      <MessageSquare
                        size={14}
                        className={`${activeId === conv.id ? 'text-app-accent' : 'text-gray-400'} shrink-0`}
                      />
                      <span className="truncate flex-1">{conv.title}</span>
                    </button>
                    <span className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity shrink-0">
                      <button
                        onClick={() => renameConversation(conv.id, conv.title)}
                        className="text-gray-400 hover:text-app-accent"
                        aria-label="Yeniden adlandır"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => deleteConversation(conv.id, conv.title)}
                        className="text-gray-400 hover:text-red-400"
                        aria-label="Sil"
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </div>
                ))}
                {filteredConversations.length === 0 && (
                  <div className="text-xs text-gray-400 dark:text-gray-500 px-3 py-2">
                    {conversationFilter
                      ? 'Aramayla eşleşen konuşma yok.'
                      : 'Henüz geçmiş sohbet yok.'}
                  </div>
                )}
              </div>

              {/* Hafıza notu */}
              <div className="mt-4 mx-1 flex items-start gap-2 text-[11px] text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-night-850/60 border border-gray-200 dark:border-night-750 rounded-lg p-2.5">
                <Brain size={14} className="shrink-0 mt-0.5 text-app-accent" />
                <span>
                  İlgili geçmiş konuşmalar ve kayıtlı hafıza, bağlam sınırları içinde yanıtlara eklenir.
                </span>
              </div>

              {/* Uzmanlık Alanları */}
              <div className="mt-5">
                <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2 px-1">
                  Uzmanlık Alanları
                </h3>
                <div className="space-y-0.5">
                  {expertise.length === 0 ? (
                    <div className="text-xs text-gray-400 dark:text-gray-600 px-2 py-1">
                      Henüz uzmanlık yok.
                    </div>
                  ) : (
                    expertise.map((e) => (
                      <div
                        key={e.id}
                        className="group flex items-center gap-2 px-2 py-1.5 text-sm text-gray-600 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-night-800"
                      >
                        <BookOpen size={14} className="text-amber-500 shrink-0" />
                        <span className="truncate flex-1" title={e.summary}>
                          {e.topic}
                        </span>
                        <button
                          onClick={() => removeExpertise(e.id)}
                          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 transition-opacity"
                          aria-label="Sil"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-night-750 space-y-1">
          <button
            onClick={onToggleTheme}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-night-800 rounded-lg transition-colors text-left"
            title="Tıkla: Karanlık → Siyah → Beyaz"
          >
            {theme === 'light' ? (
              <Sun size={18} className="text-gray-400" />
            ) : theme === 'black' ? (
              <Circle size={18} className="text-gray-400" fill="currentColor" />
            ) : (
              <Moon size={18} className="text-gray-400" />
            )}
            <span className="font-medium">{themeLabel[theme]}</span>
            <span className="ml-auto text-[10px] text-gray-400">
              sıradaki: {themeLabel[themeNext[theme]]}
            </span>
          </button>
          <button
            onClick={onSettingsClick}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-night-800 rounded-lg transition-colors text-left"
          >
            <Settings size={18} className="text-gray-400" />
            <span className="font-medium">Ayarlar</span>
          </button>
          <p className="px-3 pt-2 text-[11px] text-gray-400 dark:text-gray-500">© 2026 Berkay Atağ · Chloe Assistant</p>
        </div>
      </div>
    </>
  );
}

/* ── Klasör düğümü (proje içinde özyinelemeli) ──────────── */

function FolderNode({
  folder,
  depth,
  folders,
  expanded,
  onToggle,
  onRename,
  onDelete,
  onCreateSubfolder,
  moveSelect,
  childrenOf,
}: {
  folder: ProjectFolder;
  depth: number;
  folders: ProjectFolder[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string, name: string) => void;
  onCreateSubfolder: (projectId: string, parentId: string | null) => void;
  moveSelect: (f: ProjectFolder) => React.ReactNode;
  childrenOf: (parentId: string) => ProjectFolder[];
}) {
  const isOpen = expanded.has(folder.id);
  const kids = childrenOf(folder.id);

  return (
    <div>
      <div
        className="group flex items-center gap-1.5 pr-2 py-1.5 rounded-md text-sm transition-colors cursor-pointer text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-night-800"
        style={{ paddingLeft: depth * 12 + 24 }}
        onClick={() => onToggle(folder.id)}
      >
        {isOpen ? (
          <ChevronDown size={14} className="text-gray-400 shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-gray-400 shrink-0" />
        )}
        {isOpen ? (
          <FolderOpen size={14} className="text-amber-500 shrink-0" />
        ) : (
          <Folder size={14} className="text-amber-500 shrink-0" />
        )}
        <span className="truncate flex-1">{folder.name}</span>
        <span
          className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => onCreateSubfolder(folder.projectId, folder.id)}
            className="text-gray-400 hover:text-app-accent"
            aria-label="Alt klasör ekle"
            title="Alt klasör ekle"
          >
            <FolderPlus size={12} />
          </button>
          {moveSelect(folder)}
          <button
            onClick={() => onRename(folder.id, folder.name)}
            className="text-gray-400 hover:text-app-accent"
            aria-label="Yeniden adlandır"
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={() => onDelete(folder.id, folder.name)}
            className="text-gray-400 hover:text-red-400"
            aria-label="Sil"
          >
            <Trash2 size={12} />
          </button>
        </span>
      </div>

      {isOpen &&
        kids.map((child) => (
          <FolderNode
            key={child.id}
            folder={child}
            depth={depth + 1}
            folders={folders}
            expanded={expanded}
            onToggle={onToggle}
            onRename={onRename}
            onDelete={onDelete}
            onCreateSubfolder={onCreateSubfolder}
            moveSelect={moveSelect}
            childrenOf={childrenOf}
          />
        ))}
    </div>
  );
}
