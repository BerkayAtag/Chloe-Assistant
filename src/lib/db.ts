import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { randomUUID } from 'node:crypto';
import { join } from 'path';
import { dataDirectory } from './data-dir.ts';

const DATA_DIR = dataDirectory();
const CONVERSATIONS_FILE = join(DATA_DIR, 'conversations.json');

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
  if (!existsSync(CONVERSATIONS_FILE)) {
    writeFileSync(CONVERSATIONS_FILE, JSON.stringify([]), 'utf-8');
  }
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

function readConversations(): Conversation[] {
  ensureDataDir();
  const raw = readFileSync(CONVERSATIONS_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeConversations(data: Conversation[]) {
  ensureDataDir();
  const temporary = `${CONVERSATIONS_FILE}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
  renameSync(temporary, CONVERSATIONS_FILE);
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function getAllConversations(): Omit<Conversation, 'messages'>[] {
  return readConversations()
    .map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function getConversation(id: string): Conversation | null {
  const convs = readConversations();
  return convs.find(c => c.id === id) || null;
}

export function createConversation(title: string): Conversation {
  const convs = readConversations();
  const now = new Date().toISOString();
  const conv: Conversation = {
    id: generateId(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: []
  };
  convs.push(conv);
  writeConversations(convs);
  return conv;
}

export function addMessage(conversationId: string, role: 'user' | 'assistant', content: string): Message {
  const convs = readConversations();
  const conv = convs.find(c => c.id === conversationId);
  if (!conv) throw new Error('Conversation not found');

  const msg: Message = {
    id: generateId(),
    role,
    content,
    createdAt: new Date().toISOString()
  };
  conv.messages.push(msg);
  conv.updatedAt = new Date().toISOString();
  writeConversations(convs);
  return msg;
}

export function renameConversation(id: string, title: string): Conversation | null {
  const convs = readConversations();
  const conv = convs.find(c => c.id === id);
  if (!conv) return null;
  conv.title = (title || conv.title).trim();
  conv.updatedAt = new Date().toISOString();
  writeConversations(convs);
  return conv;
}

export function deleteConversation(id: string): boolean {
  const convs = readConversations();
  const next = convs.filter(c => c.id !== id);
  if (next.length === convs.length) return false;
  writeConversations(next);
  return true;
}

export function searchMemory(
  query: string,
  limit = 15
): { conversation: Omit<Conversation, 'messages'>; message: Message }[] {
  const convs = readConversations();
  const results: { conversation: Omit<Conversation, 'messages'>; message: Message }[] = [];
  const lowerQuery = query.toLowerCase();

  for (const conv of convs) {
    const convMeta = {
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    };
    for (const msg of conv.messages) {
      if (msg.content.toLowerCase().includes(lowerQuery)) {
        results.push({ conversation: convMeta, message: msg });
      }
    }
  }
  // En yeniden eskiye sırala ve sınırla
  return results
    .sort((a, b) => new Date(b.message.createdAt).getTime() - new Date(a.message.createdAt).getTime())
    .slice(0, limit);
}

/**
 * Diğer konuşmalardan derlenen kalıcı "bellek" bağlamı. Asistanın geçmiş
 * konuşmaları asla unutmaması için sistem promptuna eklenir: her konuşmanın
 * son 6 mesajı alınır; toplamda en çok 60 mesaj / 16.000 karakter kullanılır.
 */
export function getMemoryContext(
  excludeId: string | null,
  maxMessages = 60,
  maxChars = 16000
): string {
  const convs = readConversations();
  const recent: { title: string; date: string; role: string; content: string }[] = [];

  for (const conv of convs) {
    if (excludeId && conv.id === excludeId) continue;
    const last = conv.messages.slice(-6);
    for (const m of last) {
      recent.push({
        title: conv.title,
        date: new Date(m.createdAt).toLocaleDateString('tr-TR'),
        role: m.role,
        content: m.content,
      });
    }
  }

  if (recent.length === 0) return '';

  let chars = 0;
  const picked: typeof recent = [];
  for (const r of recent.slice(-maxMessages).reverse()) {
    const body = r.content.slice(0, 400);
    chars += body.length;
    if (chars > maxChars) break;
    picked.push({ ...r, content: body });
  }
  picked.reverse();

  return picked
    .map(
      (r) =>
        `[${r.title} · ${r.date}] ${r.role === 'user' ? 'Kullanıcı' : 'Asistan'}: ${r.content}`
    )
    .join('\n');
}
