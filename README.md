<div align="center">

# Chloe Assistant

### Your AI workspace. Your model. Your projects.

One assistant for voice conversations, research, creative work, and hands-on
software development — available in your browser and as a native macOS app.

**Open source · Model choice is yours · Built for macOS and the web**

</div>

---

Chloe brings everyday AI assistance and project work into one calm, focused
workspace. Connect a hosted or local model, talk naturally, research a topic,
or open a project folder and work directly with its files.

## What you can do

| Workspace | Capabilities |
| --- | --- |
| **Chloe Code** | Choose a project folder, browse and edit files, ask your selected model for a proposed change, review it before applying, and explicitly run the project's available checks. |
| **Voice & JARVIS** | Speak with the assistant using supported browser or macOS speech recognition and text-to-speech. |
| **Agent Office** | Coordinate focused agents for research and coding tasks; inspect file proposals and apply them yourself. |
| **Web & browser** | Research public sources and use the browser automation available in the local app. |
| **Image & video** | Generate media when your configured provider and model expose compatible generation APIs. |
| **Skills** | Browse and install Agent Skills, review their contents, and assign them to individual agents. |

Chloe can connect to OpenAI, Anthropic, Google Gemini, OpenAI-compatible
providers, and local Ollama endpoints. Provider capabilities differ: tools,
reasoning controls, speech, image generation, and video generation depend on
the model and API you configure. Chloe reports unsupported operations rather
than silently switching to a different provider.

## Choose your workspace

### Browser

Run Chloe locally, then open `http://localhost:3000`. The browser UI works on
desktop and mobile. When using the browser version on the same Mac, type the
absolute project path into **Chloe Code** to open a folder.

### macOS app

The native app adds Finder-based project selection, a local WKWebView browser,
and macOS integrations. The same project editor runs inside the app.

## Get started

**Requirements:** macOS for the native app; Node.js 20.9 or newer for the web
server. An AI provider connection is needed for model responses.

```bash
git clone https://github.com/BerkayAtag/chloe-assistant.git
cd chloe-assistant
npm install
npm run dev
```

Open `http://localhost:3000`, choose **Settings**, and configure a provider.
For local inference, start Ollama and select its OpenAI-compatible endpoint.
For hosted models, add your provider key in Chloe's settings. API keys and
conversation data are local application data and are not part of the source
repository.

To build and launch the macOS app from the project root:

```bash
./script/build_and_run.sh --verify
```

The app uses the web workspace on `http://localhost:3000` by default. If that
port is unavailable, use the URL printed by the startup script.

## Chloe Code

Select **+ → Codex** in the chat. On macOS, use **Klasör seç** to pick a project
in Finder; in a browser, enter its absolute local path. Choose a file from the
project tree, edit it, or write an instruction for the configured AI model.

AI edits appear as a reviewable proposal first. **Editöre al** places the
proposal in the editor; **Kaydet** is a separate action that writes the file.
The save checks the file version to avoid overwriting changes made elsewhere.
Use the project check selector to run detected tests, lint, build, Swift, or
Git checks. Each run requires confirmation and has a time and output limit.
Project checks execute the selected project's own scripts, so only run them
for folders you trust.

For ordinary source changes, Chloe Code does not run arbitrary shell commands
or save a model's edits without your approval. Hidden credential files,
dependency/build folders, binary files, and symbolic links are excluded from
the project browser.

## Privacy & safety

- The application is intended to run on a trusted local device.
- Conversations, uploads, skills, provider settings, and agent data are
  application data. They are excluded from Git by `.gitignore`.
- When you use a hosted provider, the prompt and selected file content are sent
  to that provider to answer your request.
- File edits require an explicit save. Project checks require an explicit
  confirmation.
- Computer-control and browser features can interact with your device or the
  web; review permissions and actions before approving them.

Do not expose the local server to an untrusted network. Do not commit API keys,
OAuth tokens, personal conversations, generated uploads, or private project
files.

## Development

```bash
npm run lint
npx tsc --noEmit
npm run test:codex
npm run test:runtime
npm run test:voice-ui
npm run test:connections
npm run test:office
npm run test:skills
npm run build
```

The native macOS target is a Swift package under `macos/`.

---

<div align="center">

**Chloe Assistant** — one workspace for thinking, creating, and building.

</div>
