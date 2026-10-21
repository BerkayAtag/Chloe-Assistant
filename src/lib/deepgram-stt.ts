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
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private finishing = false;

  constructor(apiKey: string, config: Partial<DeepgramSTTConfig> = {}) {
    this.apiKey = apiKey;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Send a complete audio file for transcription (non-streaming)
   */
  async transcribe(buffer: Buffer, signal?: AbortSignal): Promise<TranscriptionResult> {
    const params = new URLSearchParams({
      model: this.config.model || 'nova-3', language: this.config.language || 'en-US',
      smart_format: String(this.config.smart_format ?? true), punctuate: String(this.config.punctuate ?? true),
    });
    const url = `https://api.deepgram.com/v1/listen?${params}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': 'application/octet-stream',
      },
      body: buffer as unknown as BodyInit,
      signal: AbortSignal.any([AbortSignal.timeout(25_000), ...(signal ? [signal] : [])]),
    });
    if (!res.ok) {
      throw new Error(`Deepgram API hatasi: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    const channel = data.results?.channels?.[0]?.alternatives?.[0];
    return {
      text: channel?.transcript || '',
      isFinal: true,
      confidence: channel?.confidence ?? 0,
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
    this.disconnect();
    this.finishing = false;
    const params = new URLSearchParams({
      model: this.config.model || 'nova-3',
      language: this.config.language || 'en-US',
      smart_format: String(this.config.smart_format ?? true),
      punctuate: String(this.config.punctuate ?? true),
      capitalization: String(this.config.capitalization ?? true),
      interim_results: String(this.config.interim_results ?? true),
      encoding: this.config.encoding || 'linear16',
      sample_rate: String(this.config.sample_rate || 16000),
    });
    const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
    let socket: WebSocket;
    try {
      // Native browser/Node WebSocket accepts protocols, not ws package options.
      socket = new WebSocket(wsUrl, ['token', this.apiKey]);
      this.socket = socket;
    } catch {
      onError?.('Deepgram bağlantısı başlatılamadı. Anahtar biçimini kontrol et.');
      return false;
    }

    this.socket.onopen = () => {
      // Ready to receive audio
    };

    this.socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'Error') { onError?.('Deepgram ses akışını reddetti.'); this.disconnect(); return; }
        const channel = data.channel?.alternatives?.[0];
        const transcript = channel?.transcript || '';
        if (transcript.trim()) {
          onResult({
            text: transcript,
            isFinal: data.is_final || false,
            confidence: (channel?.confidence ?? 0) as number,
            speechFinal: data.speech_final || false,
          });
        }
      } catch {
        onError?.('Deepgram yaniti parse edilemedi');
      }
    };

    this.socket.onerror = () => {
      if (this.socket !== socket) return;
      onError?.('Deepgram WebSocket bağlantısı başarısız.');
      this.disconnect();
    };

    this.socket.onclose = () => {
      if (this.socket !== socket) return;
      clearTimeout(this.closeTimer);
      this.socket = null;
    };

    return true;
  }

  /**
   * Send audio data chunk for streaming transcription
   */
  sendAudio(data: Buffer): void {
    if (!this.finishing && this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(data);
    }
  }

  /**
   * Finish streaming and get final transcript
   */
  finish(): void {
    if (!this.finishing && this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.finishing = true;
      // CloseStream flushes final Results before the server closes the socket.
      this.socket.send(JSON.stringify({ type: 'CloseStream' }));
      this.closeTimer = setTimeout(() => this.disconnect(), 10_000);
    }
  }

  /**
   * Disconnect without finalizing
   */
  disconnect(): void {
    clearTimeout(this.closeTimer);
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.close();
    }
  }
}
