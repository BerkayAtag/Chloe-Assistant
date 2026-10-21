/**
 * Built-in Tools — Ported from Jarvis AI Assistant to Chloe
 *
 * Source: https://github.com/akshayaggarwal99/jarvis-ai-assistant
 *   src/tools/app-launcher-tool.ts
 *   src/tools/cli-tool.ts
 *   src/tools/filesystem-tool.ts
 *   src/tools/system-info-tool.ts
 * License: MIT
 */

import { getToolRegistry } from './tool-registry.ts';

/**
 * Register all built-in tools to the default registry
 */
export function registerBuiltinTools(): void {
  const registry = getToolRegistry();

  // 1. Web Search Tool — wraps Chloe's searchWeb (imported lazily)
  registry.register(
    'search_web',
    'İnternette arama yap. Güncel bilgi ve kaynaklar için kullanılır.',
    {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Arama sorgusu' },
      },
      required: ['query'],
    },
    async (args) => {
      const { searchWeb } = await import('./search.ts');
      const query = typeof args.query === 'string' ? args.query : '';
      const results = await searchWeb(query, 4);
      return JSON.stringify(results);
    }
  );

  // 2. Read Page Tool — wraps Chloe's readPublicPage (imported lazily)
  registry.register(
    'read_page',
    'Açık bir web sayfasını oku. Sayfa içeriği veri olarak döner.',
    {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Okunacak web sayfası adresi' },
      },
      required: ['url'],
    },
    async (args) => {
      const { readPublicPage } = await import('./public-page.ts');
      const url = typeof args.url === 'string' ? args.url : '';
      const content = await readPublicPage(url);
      return content.slice(0, 5000);
    }
  );

  // 3. Open App / URL Tool (ported from Jarvis app-launcher-tool)
  registry.register(
    'open_app',
    'Uygulama veya web sitesi aç. Örn: "open YouTube", "launch Chrome", "google.com".',
    {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Açılacak uygulama adı veya URL' },
      },
      required: ['target'],
    },
    async (args) => {
      const target = typeof args.target === 'string' ? args.target : '';
      return JSON.stringify({ action: 'open_app', target });
    }
  );

  // 4. System Info Tool (ported from Jarvis system-info-tool)
  registry.register(
    'get_system_info',
    'Sistem bilgilerini getir: platform, bellek, CPU, çalışma süresi.',
    {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'İstenen bilgi tipi',
          enum: ['basic', 'memory', 'cpu', 'all'],
        },
      },
    },
    async (args) => {
      const type = typeof args.type === 'string' ? args.type : 'basic';
      const os = await import('node:os');
      if (type === 'memory') {
        return JSON.stringify({
          totalMemory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB`,
          freeMemory: `${Math.round(os.freemem() / 1024 / 1024 / 1024)} GB`,
        });
      }
      return JSON.stringify({
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        uptime: `${Math.round(os.uptime() / 3600)} saat`,
      });
    }
  );

  // 5. Command Runner Tool (with explicit approval flag)
  registry.register(
    'run_command',
    'Terminal/zsh komutu hazırla. Onay gerektirir.',
    {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Çalıştırılacak zsh komutu' },
      },
      required: ['command'],
    },
    async (args) => {
      const command = typeof args.command === 'string' ? args.command : '';
      return JSON.stringify({ action: 'run_command', command, requiresApproval: true });
    },
    { requiresApproval: true }
  );
}

