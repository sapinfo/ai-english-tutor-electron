# CLAUDE.md — AI English Tutor (Electron)

## Project Overview
AI English Tutor는 음성 기반 ESL 학습 Electron 데스크톱 앱입니다.
가상 영어 선생님 Ms. Sarah와 실시간 음성 대화로 영어를 학습합니다.

## Tech Stack
- **Runtime**: Electron 39 + Vite 7 + Svelte 5
- **STT**: Speechmatics Real-time WebSocket API (`pcm_s16le`, 16kHz)
- **LLM**: Groq API (`meta-llama/llama-4-scout-17b-16e-instruct`)
- **TTS**: Kokoro MLX local server (Apple Silicon, port 8881)
- **DB**: SQLite (better-sqlite3) — curriculum + progress

## Architecture
```
src/main/index.js      → Electron main process (IPC handlers, DB, API calls, Kokoro management)
src/preload/index.js   → IPC bridge (window.api)
src/renderer/src/      → Svelte UI (App.svelte)
resources/tutor.db     → SQLite curriculum database (58 lessons, 6 levels)
resources/kokoro_tts_server.py → Kokoro MLX TTS server (FastAPI)
```

## Key IPC Channels
- `db:getLevelsWithLessons` — lesson picker data
- `db:getLessonWithSections` — lesson detail with sections
- `db:getProgress` / `db:saveProgress` — student progress
- `chat:groq` — LLM chat (API key passed from renderer)
- `tts:kokoro` — text-to-speech (returns WAV buffer)
- `tts:kokoro-status` / `tts:kokoro-start` / `tts:kokoro-stop` — server management
- `stt:speechmatics-jwt` — JWT token generation for WebSocket auth

## Running
```bash
# Must run from a terminal WITHOUT ELECTRON_RUN_AS_NODE=1
# (VSCode/Claude Code terminals set this — use Terminal.app)
npm run dev
```

## Build Commands
```bash
npx electron-vite build          # Build only
npm run build:mac                # macOS DMG
npm run build:win                # Windows installer
```

## Important Notes
- `ELECTRON_RUN_AS_NODE=1` env var (set by VSCode/Claude Code) prevents Electron from launching. Always use a separate terminal.
- Kokoro TTS server is a Python process spawned by main process. User must click "TTS Start" before starting a lesson.
- `better-sqlite3` is a native module — run `npx electron-rebuild -f -w better-sqlite3` after `npm install`.
- Speechmatics uses `pcm_s16le` encoding (not float32). Audio is converted in renderer before sending.
- The hallucination filter was removed — Speechmatics handles noise well on its own. Do NOT add word-level filters for common English words.
- Speech debounce (default 2s) is configurable in Settings. It waits for silence before sending accumulated text to LLM.

## API Keys Required
- **Groq**: console.groq.com (free tier)
- **Speechmatics**: portal.speechmatics.com (free tier)
- Both stored in localStorage, entered via Settings UI
