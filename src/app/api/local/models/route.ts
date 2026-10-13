/**
 * Local LLM (Ollama) üzerindeki modelleri listeler.
 * Önce OpenAI uyumlu `/v1/models` denenir, olmazsa Ollama yerel `/api/tags` kullanılır.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const base = (searchParams.get('url') || 'http://127.0.0.1:11434').replace(/\/+$/, '');

    const normalize = (u: string) => u.replace(/\/+$/, '');

    // 1) OpenAI uyumlu uç nokta
    try {
      const res = await fetch(`${normalize(base)}/models`, {
        headers: { Authorization: 'Bearer ollama' },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        const ids = (data.data || [])
          .map((m: { id?: string }) => m?.id)
          .filter((id: string | undefined): id is string => typeof id === 'string');
        if (ids.length > 0) {
          return Response.json({ success: true, source: 'openai', models: ids });
        }
      }
    } catch {
      /* devam */
    }

    // 2) Ollama yerel API (v1 soneki varsa kaldır)
    const nativeBase = normalize(base).replace(/\/v1$/, '');
    const res = await fetch(`${nativeBase}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return Response.json(
        {
          error: `Ollama'ya ulaşılamadı (HTTP ${res.status}). Endpoint'i ve "OLLAMA_HOST=0.0.0.0 ollama serve" komutunu kontrol et.`,
        },
        { status: 502 }
      );
    }
    const data = await res.json();
    const models = (data.models || [])
      .map((m: { name?: string }) => m?.name)
      .filter((name: string | undefined): name is string => typeof name === 'string');
    return Response.json({ success: true, source: 'ollama', models });
  } catch (e: unknown) {
    return Response.json(
      {
        error:
          e instanceof Error && e.message
            ? e.message
            : 'Model listesi alınamadı.',
      },
      { status: 502 }
    );
  }
}
