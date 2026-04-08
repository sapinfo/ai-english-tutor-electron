# CLAUDE.md — TalkWith Sarah (AI English Tutor)

## Project Overview
TalkWith Sarah는 음성 기반 ESL 학습 Electron 데스크톱 앱입니다.
가상 영어 선생님 Ms. Sarah와 실시간 음성 대화로 영어를 학습합니다.

## Tech Stack
- **Runtime**: Electron 39 + Vite 7 + Svelte 5
- **STT**: Speechmatics Real-time WebSocket API (`pcm_s16le`, 16kHz)
- **LLM**: Groq API (`meta-llama/llama-4-scout-17b-16e-instruct`)
- **TTS**: Kokoro TTS (cross-platform: kokoro-mlx for Apple Silicon, kokoro ONNX for others)
- **DB**: SQLite (better-sqlite3) — curriculum + progress

## Architecture
```
src/main/index.js      → Electron main process (IPC, DB, APIs, Kokoro process management)
src/preload/index.js   → IPC bridge (window.api)
src/renderer/src/      → Svelte UI (App.svelte)
resources/tutor.db     → SQLite curriculum database (58 lessons, 6 levels)
resources/kokoro_tts_server.py → Cross-platform Kokoro TTS server (FastAPI)
```

## Key IPC Channels
- `db:getLevelsWithLessons` — lesson picker data
- `db:getLessonWithSections` — lesson detail with sections
- `db:getProgress` / `db:saveProgress` — student progress
- `chat:groq` — LLM chat (API key passed from renderer)
- `tts:kokoro` — text-to-speech (returns WAV buffer)
- `tts:kokoro-status` / `tts:kokoro-start` / `tts:kokoro-stop` — server management
- `stt:speechmatics-jwt` — JWT token generation for WebSocket auth
- `kokoro:error` — main→renderer error notification (Python not found, etc.)

## Running
```bash
# Dev mode — must use terminal WITHOUT ELECTRON_RUN_AS_NODE=1
# (VSCode/Claude Code terminals set this — use Terminal.app)
npm run dev

# Production app
dist/mac-arm64/TalkWith Sarah.app
# or install to /Applications
```

## Build Commands
```bash
npx electron-vite build          # Build only
npm run build:mac                # macOS DMG
npm run build:win                # Windows installer
npm run build:linux              # Linux AppImage + deb
```

## Release
```bash
git tag v1.x.x && git push origin v1.x.x
# GitHub Actions auto-builds macOS/Windows/Linux and publishes Release
```

## Critical Notes

### DO NOT
- **DO NOT add hallucination filters** for common English words. Speechmatics is accurate. Previous filter blocked "this", "is", "it" etc. and broke the app.
- **DO NOT use CSP meta tags** in index.html. Removed because it breaks file:// protocol in packaged app.
- **DO NOT use custom protocols (app://)** for renderer loading. Causes white screen. Use `mainWindow.loadFile()`.
- **DO NOT use `@electron-toolkit/utils`** — causes `electron.app.isPackaged` crash due to ELECTRON_RUN_AS_NODE in dev environments.

### MUST
- **macOS microphone**: entitlements.mac.plist must include `com.apple.security.device.audio-input`. Main process must call `systemPreferences.askForMediaAccess('microphone')` before window creation.
- **Python path**: Packaged macOS app doesn't inherit shell PATH. `findPython()` tries pyenv, homebrew, system paths, and shell login fallback.
- **Kokoro server**: Spawned with `detached: true` (macOS/Linux). On Windows, uses `taskkill /T /F` for cleanup. Port 8881 fallback kill on stop.
- **better-sqlite3**: Native module. Run `npx electron-rebuild -f -w better-sqlite3` after `npm install`.
- **Speechmatics audio**: Must be `pcm_s16le` (int16), not float32. Conversion happens in renderer ScriptProcessor.
- **Speech debounce**: Default 2s. Configurable in Settings. Accumulates AddTranscript events before sending to LLM.

## API Keys Required
- **Groq**: console.groq.com (free tier)
- **Speechmatics**: portal.speechmatics.com (free tier)
- Both stored in localStorage, entered via Settings UI

## User Flow
```
① TTS Start → ② Select Lesson → ③ Start → Learn → ④ End Lesson → ⑤ TTS Stop
```
TTS server uses ~200MB memory. Must stop after learning.
