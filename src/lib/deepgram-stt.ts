/**
 * Deepgram STT Provider — Port of Jarvis AI Assistant's streaming transcription
 *
 * Source: https://github.com/akshayaggarwal99/jarvis-ai-assistant
 *   src/transcription/deepgram-streaming-transcriber.ts
 *   src/services/transcription-service.ts
 * License: MIT
 *
 * WebSocket-based streaming transcription with live feedback.
 * Chloe already supports Gemini PCM streaming; this adds Deepgram as an option.
 */

export interface DeepgramSTTConfig {
  model?: string;
  language?: string;
  smart_format?: boolean;
  punctuate?: boolean;
  capitalization?: boolean;
  encoding?: 'linear16' | 'mulaw' | 'opus';
  sample_rate?: number;
  interim_results?: boolean;
}

export interface TranscriptionResult {
  text: string;
  isFinal: boolean;
  confidence: number;
  speechFinal: boolean;
}

export const DEFAULT_CONFIG: DeepgramSTTConfig = {
  model: 'nova-3',
  language: 'en-US',
  smart_format: true,
  punctuate: true,
  capitalization: true,
  encoding: 'linear16',
  sample_rate: 16000,
  interim_results: true,
};

/**
 * Deepgram STT Client
 * Provides WebSocket-based streaming transcription for Chloe.
 */
export class DeepgramSTTClient {
  private apiKey: string;
  private config: DeepgramSTTConfig;
  private socket: WebSocket | null = null;

  constructor(apiKey: string, config: Partial<DeepgramSTTConfig> = {}) {
    this.apiKey = apiKey;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Send a complete audio file for transcription (non-streaming)
   */
  async transcribe(buffer: Buffer): Promise<TranscriptionResult> {
    const url = `https://api.deepgram.com/v1/listen?model=${this.config.model}&language=${this.config.language}&smart_format=${this.config.smart_format}&punctuate=${this.config.punctuate}&capitalization=${this.config.capitalization}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': 'application/octet-stream',
      },
      body: buffer as unknown as BodyInit,
    });
    if (!res.ok) {
      throw new Error(`Deepgram API hatasi: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    const channel = data.results?.channels?.[0]?.alternatives?.[0];
    return {
      text: channel?.transcript || '',
      isFinal: true,
      confidence: channel?.confidence || 0.9,
      speechFinal: true,
    };
  }

  /**
   * Connect WebSocket for streaming transcription
   */
  connect(onResult: (result: TranscriptionResult) => void, onError?: (error: string) => void): boolean {
    if (typeof WebSocket === 'undefined') {
      onError?.('WebSocket desteklenmiyor');
      return false;
    }
    const params = new URLSearchParams({
      model: this.config.model || 'nova-3',
      language: this.config.language || 'en-US',
      smart_format: String(this.config.smart_format ?? true),
      punctuate: String(this.config.punctuate ?? true),
      capitalization: String(this.config.capitalization ?? true),
      interim_results: String(this.config.interim_results ?? true),
    });
    const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
    const wsOptions: Record<string, unknown> = {};
    if (typeof window === 'undefined') {
      wsOptions.headers = { Authorization: `Token ${this.apiKey}` };
    }
    // Cast to any — WebSocket browser/native overloads differ, and this only
    // runs server-side in Chloe's native bridge. Safe within this scope.
    this.socket = new (WebSocket as unknown as new (url: string, options?: Record<string, unknown>) => WebSocket)(wsUrl, wsOptions);

    this.socket.onopen = () => {
      // Ready to receive audio
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const channel = data.results?.channels?.[0]?.alternatives?.[0];
        const transcript = channel?.transcript || '';
        if (transcript.trim()) {
          onResult({
            text: transcript,
            isFinal: data.is_final || false,
            confidence: (channel?.confidence || 0.9) as number,
            speechFinal: data.speech_final || false,
          });
        }
      } catch {
        onError?.('Deepgram yaniti parse edilemedi');
      }
    };

    this.socket.onerror = (error) => {
      const msg = error instanceof Error ? error.message : String(error);
      onError?.(`WebSocket hatasi: ${msg}`);
    };

    this.socket.onclose = () => {
      this.socket = null;
    };

    return true;
  }

  /**
   * Send audio data chunk for streaming transcription
   */
  sendAudio(data: Buffer): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(data);
    }
  }

  /**
   * Finish streaming and get final transcript
   */
  finish(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'Finalize' }));
      this.socket.close();
    }
  }

  /**
   * Disconnect without finalizing
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
