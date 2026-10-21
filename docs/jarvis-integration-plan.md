# Jarvis Integration Plan (Tam Entegrasyon D)

## Overview

This documents the plan to port Jarvis AI Assistant (`akshayaggarwal99/jarvis-ai-assistant` v1.3.11) functions into Chloe Assistant (v0.2.7).
Chloe is a Next.js 16 + Swift native macOS app. Jarvis is Electron 44 + webpack + native C++ addons.

**Goal:** All cross-platform Jarvis functions work in Chloe. Native-only functions get Swift equivalents.

---

## 1. Current State

### Chloe (v0.2.7)
- **Mimari:** Next.js App Router + Swift WebView bridge
- **API:** 22 routes (chat, voice, jarvis, office, codex, settings, providers, etc.)
- **Lib:** 42 modules
- **Tests:** 26 test suites (✅ 179/179 passing)
- **Port:** `127.0.0.1:3004`

### Jarvis (v1.3.11)
- **Mimari:** Electron + webpack + native C++ addons (`fn-key-monitor`, `audio_capture`, `typing_monitor`)
- **Core:** 6 tools, 40+ services, 11 transcribers, LangGraph agents
- **Features:** Text enhancement, nudge system, MCP SDK, Deepgram streaming, local Whisper

---

## 2. Integration Scope

### A. Immediate (TypeScript only, no native deps)
1. **Jarvis prompt system** (`src/prompts/prompts.ts`)
2. **Universal tool registry** (`src/tools/tool-registry.ts` + tools)
3. **Text enhancement** (`src/services/cloud-text-enhancement.ts`)
4. **Nudge system** (`src/services/user-nudge-service.ts`, `nudge-templates.ts`)
5. **Dictionary system** (`src/services/dictionary.ts`, `node-dictionary.ts`)
6. **MCP SDK integration** (`@modelcontextprotocol/sdk`)

### B. Medium (Adapter pattern)
1. **Deepgram streaming provider** for voice routes
2. **LangGraph agent patterns** into Chloe's Office engine

### C. Long-term (Swift native)
1. **Local Whisper/Sherpa** → Chloe.swift port
2. **Fn-key monitor** → Chloe.swift global hotkey
3. **Audio capture** → Chloe.swift microphone

---

## 3. Implementation Phases

### Phase 1: Prompt System & Text Enhancement (1-2 days)
**Target:** `src/lib/speech-text.ts`, `src/app/api/chat/route.ts`

- [ ] Import Jarvis prompts into `src/lib/jarvis-prompts.ts`:
  - Signature preservation (CRITICAL)
  - Dictation cleaning (filler removal, homophone fixes, emoji conversion, file extensions)
  - Email formatting
- [ ] Create `cleanSpeechText` wrapper that uses Jarvis dictation prompt before TTS
- [ ] Add `enhanceText` function using cloud LLM (grammar/spelling correction)
- [ ] Export new tests: `test:text-enhancement`
- [ ] Apply to `src/lib/speech-text.ts` (integrate with existing `cleanSpeechText`)

### Phase 2: Universal Tool Registry (3-5 days)
**Target:** `src/lib/tools/`, `src/lib/office-engine.ts`

- [ ] Port `tool-registry.ts` to `src/lib/tool-registry.ts`
- [ ] Implement 6 tools:
  1. `open_app` → Chloe native `sendNativeAction('openBrowser')`
  2. `capture_screen` → Chloe native screenshot (reuses existing)
  3. `analyze_screen` → new API route + vision tool
  4. `run_command` → Chloe native `BoundedCommand` (already Swift)
  5. `file_operation` → reuse existing codec workspace file APIs
  6. `get_system_info` → new native bridge action
- [ ] Create `src/lib/tool-router.ts` (LangChain-style)
- [ ] Integrate tools into agent loop in `office-engine.ts`
- [ ] Add to `src/lib/native-bridge.ts`:
  - `get_system_info` action
- [ ] Tests: `script/tool-registry.test.mjs`

### Phase 3: Nudge System (2-3 days)
**Target:** `src/lib/nudge.ts`, `src/app/api/chat/route.ts`

- [ ] Port `user-nudge-service.ts` → `src/lib/nudge.ts`
- [ ] Implement `nudge-templates.ts` (pre-defined nudges)
- [ ] Add `/api/nudge` endpoint
- [ ] Trigger on incomplete responses (user stopped mid-sentence, partial code)
- [ ] Integrate with speech queue (offer to continue/rephrase)

### Phase 4: MCP SDK Integration (2 days)
**Target:** `src/lib/mcp-client.ts`, `src/app/api/tools/`

- [ ] Install `@modelcontextprotocol/sdk`
- [ ] Create `src/lib/mcp-client.ts` for MCP server registration
- [ ] Auto-discover local MCP servers (from `~/.mcp/servers.json`)
- [ ] Expose MCP tools via `tool-registry.ts`
- [ ] Document MCP server config in README
- [ ] Test with sample MCP server

### Phase 5: Command Parsing & Intent Router (3-4 days)
**Target:** `src/lib/jarvis-command.ts`, `src/app/api/jarvis/command/route.ts`

- [ ] Replace/extend existing intent regex with Jarvis `intelligent-command-parser.ts`
- [ ] Support chained commands + parameters
- [ ] Add `parseCommand` function with NLP fallback
- [ ] Integrate nudge system for ambiguous commands
- [ ] Tests: `script/jarvis-intent.test.mjs`

### Phase 6: Deepgram Provider (2 days)
**Target:** `src/app/api/voice/route.ts`

- [ ] Install deepgram SDK
- [ ] Create `DeepgramTranscriber` wrapper in `src/lib/deepgram-stt.ts`
- [ ] Add Deepgram as optional STT provider alongside existing Gemini PCM
- [ ] Wire into voice route's fallback chain
- [ ] Update `JarvisSettingsModal.tsx` with provider toggle

### Phase 7: Native Local Whisper (Swift) (Long-term)

#### Swift: `audio_capture`, `fn-key-monitor` replacements
- [ ] Replace C++ `audio_capture.node` with AVAudioEngine (already in `main.swift`)
- [ ] Replace `fn-key-monitor.node` with NSEvent global monitor
- [ ] Replace `typing_monitor.node` with CGEventTap

#### Local Whisper/Sherpa
- [ ] Integrate `sherpa-onnx` Swift bindings
- [ ] Create model download manager (reuse `sherpa-model-downloader.ts` logic)
- [ ] Wire into transcription pipeline
- [ ] Native bridge: `startLocalDictation`, `stopLocalDictation`

---

## 4. Test Strategy

New test suites to add:
- `script/text-enhancement.test.mjs` — grammar correction, signature preservation
- `script/tool-registry.test.mjs` — tool registration, execution, errors
- `script/nudge.test.mjs` — nudge triggers, templates
- `script/mcp.test.mjs` — MCP tool listing, execution
- `script/dictionary.test.mjs` — local dictionary words

Existing tests must remain green:
```bash
npm run test:runtime && npm run test:voice-ui && npm run test:jarvis && \
npm run test:speech-text && npm run test:barge-in && npm run test:audio-cues && \
npm run test:connections && npm run test:skills && npm run test:codex && \
npm run test:workbench && npx tsc --noEmit && npm run lint
```

Then:
```bash
./script/build_and_run.sh --verify
npm run test:jarvis-api && npm run test:jarvis-key && npm run test:codex-api && npm run test:workbench-api
```

---

## 5. Security Considerations

1. **Tool sandboxing**: All native commands go through `BoundedCommand.swift` (128KB limit, 60s timeout)
2. **SSRF protection**: Reuse existing `request-origin.ts` for external requests
3. **API key isolation**: `isolateJarvisConnections` already prevents key leakage between providers
4. **Native bridge**: Only pre-approved actions exposed to WebView
5. **File access**: Reuse Codex workspace's excluded directories/files list

---

## 6. Timeline

| Phase | Duration | Status |
|-------|----------|--------|
| Phase 1 (Prompts & Text) | 2 days | 🔲 Planned |
| Phase 2 (Tool Registry) | 5 days | 🔲 Planned |
| Phase 3 (Nudge System) | 3 days | 🔲 Planned |
| Phase 4 (MCP SDK) | 2 days | 🔲 Planned |
| Phase 5 (Command Parsing) | 4 days | 🔲 Planned |
| Phase 6 (Deepgram) | 2 days | 🔲 Planned |
| Phase 7 (Native Whisper) | 6 days | 🔲 Long-term |
| **Total** | **~24 days** | |

---

## 7. Priority

**Start with Phase 1 + Phase 3** (lowest risk, highest user-visible impact):
- Users get better dictation cleaning immediately
- Signature preservation prevents data loss
- Nudge system helps with incomplete responses

Let me know which phase to start on.
