import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
} from 'fs';
import { join } from 'path';
import { downloadImage, searchImages } from './search';
import { dataDirectory } from './data-dir';

const DATA_DIR = dataDirectory();
const STATE_FILE = join(DATA_DIR, 'avatar.json');
// Custom avatars live with the user's data (the macOS app bundle is read-only);
// older installs kept them in public/, which is still read as a fallback.
const AVATAR_DIR = dataDirectory('avatars');
const LEGACY_DIR = join(process.cwd(), 'public');
const avatarPath = (file: string) => existsSync(join(AVATAR_DIR, file)) ? join(AVATAR_DIR, file) : join(LEGACY_DIR, file);

export interface AvatarState {
  /** public/ altındaki özel görsel dosyası (null → varsayılan /chloe-portrait.jpg) */
  file: string | null;
  version: number;
  updatedAt: string;
}

function ensureState(): AvatarState {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(STATE_FILE)) {
    writeFileSync(
      STATE_FILE,
      JSON.stringify({ file: null, version: 0, updatedAt: '' }, null, 2),
      'utf-8'
    );
  }
  return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
}

function writeState(state: AvatarState) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

export function getAvatarState(): AvatarState {
  try {
    return ensureState();
  } catch {
    return { file: null, version: 0, updatedAt: '' };
  }
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

function sanitizeExt(contentType: string): string {
  return EXT_BY_TYPE[contentType] || 'jpg';
}

/**
 * URL'den görsel indirip avatar olarak kaydeder. Eski özel görseli temizler,
 * versiyonu artırır (istemci ?v= ile cache'i kırar).
 */
export async function updateAvatarFromUrl(url: string): Promise<AvatarState> {
  const { buffer, contentType } = await downloadImage(url);
  const ext = sanitizeExt(contentType);
  const state = ensureState();

  // Eski özel dosyayı sil
  if (state.file) {
    try {
      unlinkSync(avatarPath(state.file));
    } catch {
      /* yoksa sorun değil */
    }
  }

  const fileName = `chloe-custom-${Date.now()}.${ext}`;
  mkdirSync(AVATAR_DIR, { recursive: true });
  writeFileSync(join(AVATAR_DIR, fileName), buffer);

  state.file = fileName;
  state.version = (state.version || 0) + 1;
  state.updatedAt = new Date().toISOString();
  writeState(state);
  return state;
}

/**
 * Arama sorgusuyla internette görsel bulup ilk indirilebileni avatar yapar.
 */
export async function updateAvatarFromQuery(query: string): Promise<AvatarState> {
  const candidates = await searchImages(query, 8);
  if (candidates.length === 0) {
    throw new Error(
      `"${query}" için görsel bulunamadı. Doğrudan bir görsel URL'si de verebilirsin.`
    );
  }

  const errors: string[] = [];
  for (const c of candidates) {
    try {
      return await updateAvatarFromUrl(c.url);
    } catch (e: unknown) {
      errors.push(e instanceof Error ? e.message : 'bilinmeyen hata');
    }
  }
  throw new Error(`Hiçbir görsel indirilemedi: ${errors.slice(0, 2).join(' | ')}`);
}

/** Özel görseli kaldırıp varsayılan Chloe görseline döner. */
export function resetAvatar(): AvatarState {
  const state = ensureState();
  if (state.file) {
    try {
      unlinkSync(avatarPath(state.file));
    } catch {
      /* yoksa sorun değil */
    }
  }
  state.file = null;
  state.version = (state.version || 0) + 1;
  state.updatedAt = new Date().toISOString();
  writeState(state);
  return state;
}

/** Yetim kalmış eski özel avatar dosyalarını temizler (başlangıç bakımı). */
export function cleanupOrphanAvatars() {
  try {
    const state = getAvatarState();
    const active = state.file;
    for (const f of existsSync(AVATAR_DIR) ? readdirSync(AVATAR_DIR) : []) {
      if (f.startsWith('chloe-custom-') && f !== active) {
        try {
          unlinkSync(join(AVATAR_DIR, f));
        } catch {
          /* boş */
        }
      }
    }
  } catch {
    /* boş */
  }
}

const TYPE_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(EXT_BY_TYPE).map(([type, ext]) => [ext, type]));

/**
 * Custom avatars are written at runtime, and a production Next.js server only
 * serves public/ files that existed at build time, so the image is streamed here.
 */
export function readCustomAvatar(): { buffer: Buffer; contentType: string } | null {
  const { file } = getAvatarState();
  if (!file || !/^chloe-custom-\d+\.[a-z]+$/u.test(file)) return null;
  try {
    return { buffer: readFileSync(avatarPath(file)), contentType: TYPE_BY_EXT[file.split('.').pop() || ''] || 'image/jpeg' };
  } catch {
    return null;
  }
}
