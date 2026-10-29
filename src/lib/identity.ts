import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { dataDirectory } from './data-dir.ts';

const DATA_DIR = dataDirectory();
const IDENTITY_FILE = join(DATA_DIR, 'identity.json');

export interface Identity {
  assistantName: string;
  userName: string | null;
}

const DEFAULT_IDENTITY: Identity = {
  assistantName: 'Chloe',
  userName: null,
};

function ensureFile() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(IDENTITY_FILE)) {
    writeFileSync(IDENTITY_FILE, JSON.stringify(DEFAULT_IDENTITY, null, 2), 'utf-8');
  }
}

function read(): Identity {
  ensureFile();
  try {
    const raw = readFileSync(IDENTITY_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      assistantName: parsed.assistantName || DEFAULT_IDENTITY.assistantName,
      userName: parsed.userName ?? null,
    };
  } catch {
    return { ...DEFAULT_IDENTITY };
  }
}

function write(identity: Identity) {
  ensureFile();
  writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2), 'utf-8');
}

export function getIdentity(): Identity {
  return read();
}

export function setAssistantName(name: string): Identity {
  const clean = (name || '').trim();
  const identity = read();
  if (clean) identity.assistantName = clean;
  write(identity);
  return identity;
}

export function setUserName(name: string): Identity {
  const clean = (name || '').trim();
  const identity = read();
  identity.userName = clean || null;
  write(identity);
  return identity;
}

export function updateIdentity(patch: Partial<Identity>): Identity {
  const identity = read();
  if (typeof patch.assistantName === 'string' && patch.assistantName.trim()) {
    identity.assistantName = patch.assistantName.trim();
  }
  if (typeof patch.userName === 'string') {
    identity.userName = patch.userName.trim() || null;
  }
  write(identity);
  return identity;
}
