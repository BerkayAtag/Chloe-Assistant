# Chloe agent-workbench references

This integration is a bounded Chloe implementation, not a distribution of the
listed products or a claim of feature parity. No remote setup scripts were run.
Upstream text is untrusted input, never application-level authority.

## Adapted skill text (modified for Chloe, 2026-10-15)

`src/lib/builtin-skills.ts` contains shortened Turkish adaptations with Chloe's
permission, tool and output constraints. No upstream runtime is included.

- Agency Agents: https://github.com/msitarzewski/agency-agents
  Revision `bd956db032d907387e6b9ddebff3e18f1de8c679`.
  `engineering/engineering-code-reviewer.md` and
  `engineering/engineering-codebase-onboarding-engineer.md`.
  MIT, Copyright (c) 2025 AgentLand Contributors.
  Full notice: `licenses/agency-agents-LICENSE.txt`.
  The requested https://github.com/msitarzewski/agency-agents-app is the catalog
  application; the actual role definitions are in the above corpus.
- OpenRig: https://github.com/mvschwarz/openrig
  Revision `9122dad96929f358c37064b857aa858e7dd3a0a1`.
  `packages/daemon/assets/plugins/openrig-core/skills/delegating-work/SKILL.md`.
  Apache-2.0, Copyright 2026 Mike Schwarz.
  Full license: `licenses/openrig-LICENSE.txt`.
  Changed: translated, shortened, removed external skill/tool dependencies;
  bounded to the existing Chloe team and explicit user permissions.
- Replica: https://github.com/Jakeschincariol/replica-skill
  Revision `77c9436fb3d18c3d58169efb8caf4fe906b0dc51`.
  `replica-recon/SKILL.md`, `replica-test/SKILL.md`.
  MIT, Copyright (c) 2026 Jake Schincariol.
  Full notice: `licenses/replica-skill-LICENSE.txt`.
  Changed: combined into a concise, default developer workflow; no upstream
  scripts, templates, screenshots, logos or private API implementations included.

## Concept references; independently implemented, no source code copied

| Reference | Chloe functionality | Deliberate boundary |
| --- | --- | --- |
| https://github.com/firecrawl/firecrawl (AGPL-3.0) | Bounded same-origin HTTPS crawl, clean text, source URLs, Markdown export, robots policy | No Firecrawl engine, JS rendering, login, proxy, bulk crawl or hosted API dependency |
| https://github.com/exa-labs/company-researcher (MIT) | Source-grounded company report using selected model | Same-site report, not independent financial verification; no Exa/Anthropic key required |
| https://github.com/MxCorpIn/Repolyze (MIT) | Read-only local file/language/manifest/dependency/test inventory; send findings to team | Not full architecture tracing, vulnerability scanning, GitHub ingestion or a fabricated quality score |
| https://github.com/debpalash/VoiceStudio (AGPL-3.0) | Text-to-speech preview, playback speed and audio export | Existing configured speech API; no copied engine, downloaded weights, cloning or dubbing |
| https://github.com/vectorize-io/hindsight (MIT) | Retain/recall/reflect, fact/experience/reflection, source/time/scope, correction/archive history | Local keyword retrieval, not Hindsight graph/vector retrieval, automatic entity learning or background consolidation |
| https://github.com/thruwire/foreman (MIT) | Mandatory final artifact review, hash-bound decision, explicit tests-not-run state | Not continuous Jev supervision or autonomous test execution; user still approves writes |

Product names are attribution only. No affiliation or endorsement is implied.
Deployment of an upstream service or model requires its own license/configuration
review; those services are not silently installed by Chloe.
