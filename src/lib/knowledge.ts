import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'data');
const KNOWLEDGE_FILE = join(DATA_DIR, 'expertise.json');

export interface ExpertiseTopic {
  id: string;
  topic: string;
  summary: string;
  sources: string[];
  createdAt: string;
}

function ensureFile() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(KNOWLEDGE_FILE)) {
    writeFileSync(KNOWLEDGE_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
}

function read(): ExpertiseTopic[] {
  ensureFile();
  try {
    return JSON.parse(readFileSync(KNOWLEDGE_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function write(data: ExpertiseTopic[]) {
  ensureFile();
  writeFileSync(KNOWLEDGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function listExpertise(): ExpertiseTopic[] {
  return read();
}

export function addExpertise(topic: string, summary: string, sources: string[] = []): ExpertiseTopic {
  const data = read();
  const entry: ExpertiseTopic = {
    id: generateId(),
    topic: topic.trim(),
    summary,
    sources,
    createdAt: new Date().toISOString(),
  };
  data.push(entry);
  write(data);
  return entry;
}

export function removeExpertise(id: string): boolean {
  const data = read();
  const next = data.filter((e) => e.id !== id);
  if (next.length === data.length) return false;
  write(next);
  return true;
}

/** Uzmanlık konularını sistem promptu için bir özet liste haline getirir. */
export function expertiseContext(maxTopics = 15): string {
  const list = read().slice(0, maxTopics);
  if (list.length === 0) return '';
  return list
    .map((e) => `- ${e.topic}: ${e.summary.slice(0, 800)}`)
    .join('\n');
}
