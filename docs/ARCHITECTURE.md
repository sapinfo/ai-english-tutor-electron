# Architecture — TalkWith Sarah (AI English Tutor)

## System Overview

```
┌──────────────────────────────────────────────────────────────┐
│                     Electron App                             │
│                                                              │
│  ┌─────────────────────┐    IPC     ┌─────────────────────┐  │
│  │   Main Process       │◄─────────►│  Renderer (Svelte)   │  │
│  │                      │           │                      │  │
│  │  • SQLite DB         │           │  • Lesson Picker UI  │  │
│  │  • Groq LLM API     │           │  • Chat Interface    │  │
│  │  • Kokoro TTS proxy  │           │  • Speechmatics STT  │  │
│  │  • Speechmatics JWT  │           │  • Audio playback    │  │
│  │  • Kokoro process    │           │  • Settings          │  │
│  └─────────────────────┘           └─────────────────────┘  │
│           │                                  │               │
│           ▼                                  ▼               │
│  ┌─────────────────┐              ┌─────────────────────┐   │
│  │ Kokoro TTS      │              │ Speechmatics        │   │
│  │ (localhost:8881) │              │ (wss://eu2.rt...)   │   │
│  │ Python/FastAPI   │              │ WebSocket           │   │
│  └─────────────────┘              └─────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

## Process Architecture

### Main Process (`src/main/index.js`)

Responsibilities:
- **Window management**: BrowserWindow creation, lifecycle
- **SQLite database**: Curriculum queries, progress tracking via `better-sqlite3`
- **Groq LLM**: Builds system prompts with lesson context, calls Groq API
- **Kokoro TTS proxy**: Forwards TTS requests to local Python server
- **Kokoro process management**: Spawn/kill Python TTS server
- **Speechmatics JWT**: Generates temporary tokens for browser WebSocket auth

IPC Handlers:
| Channel | Direction | Purpose |
|---------|-----------|---------|
| `db:getLevelsWithLessons` | renderer → main | Lesson picker data |
| `db:getLessonWithSections` | renderer → main | Full lesson with sections |
| `db:getProgress` | renderer → main | Student progress |
| `db:saveProgress` | renderer → main | Save section progress |
| `chat:groq` | renderer → main | LLM chat completion |
| `tts:kokoro` | renderer → main | Text-to-speech (returns WAV buffer) |
| `tts:kokoro-status` | renderer → main | Check server health |
| `tts:kokoro-start` | renderer → main | Start TTS server |
| `tts:kokoro-stop` | renderer → main | Stop TTS server |
| `stt:speechmatics-jwt` | renderer → main | Generate JWT for WebSocket |

### Preload Script (`src/preload/index.js`)

Exposes `window.api` with typed IPC methods. Context isolation enabled.

### Renderer (`src/renderer/src/App.svelte`)

Single-component architecture (all UI in App.svelte):

- **Lesson Picker**: Grid of lessons by level, progress badges
- **Chat View**: Message bubbles (teacher/student), typing indicator
- **Speechmatics STT**: WebSocket connection, audio capture, transcript handling
- **TTS Playback**: Audio element for Kokoro WAV responses
- **Controls**: Start/Stop lesson, Mic mute, TTS toggle, Kokoro server toggle
- **Settings**: API keys, silence wait slider

## Data Flow

### Speech-to-Text Flow
```
Microphone → AudioContext (16kHz) → ScriptProcessor
    → float32 to int16 conversion (pcm_s16le)
    → WebSocket binary frame → Speechmatics server
    → AddPartialTranscript (interim) / AddTranscript (final)
    → Speech buffer (debounce 2s) → LLM
```

### LLM Flow
```
Student text → chat:groq IPC
    → Main process builds system prompt (Ms. Sarah persona + lesson context)
    → Groq API (llama-4-scout-17b-16e-instruct)
    → Response text → Renderer displays + TTS
```

### Text-to-Speech Flow
```
LLM response text → tts:kokoro IPC
    → Main process → HTTP POST localhost:8881/v1/audio/speech
    → Kokoro MLX generates WAV (af_sarah voice)
    → WAV buffer → Renderer → Blob → Audio element playback
```

## Database Schema

```sql
levels (id, title, cefr, description)
lessons (id, level_id, sort_order, title, goal, grammar_focus)
sections (id, lesson_id, sort_order, type, title, teacher_script, examples, practice_prompt, vocabulary)
progress (id, student_id, lesson_id, section_index, completed, score, updated_at)
```

- 6 levels (A1 Beginner → B2+ Business)
- 58 lessons, each with 5-6 sections
- Section types: warmup, core, practice, review

## Kokoro TTS Server

Standalone Python FastAPI server (`resources/kokoro_tts_server.py`):
- Model: `kokoro-mlx` (Kokoro-82M, 4-bit quantized, ~50MB)
- Endpoint: `POST /v1/audio/speech` (OpenAI TTS API compatible)
- Default voice: `af_sarah`
- Startup: ~3-4 seconds (model loading)
- Memory: ~200MB
- Requires: Apple Silicon Mac, Python 3.12+, `kokoro-mlx`, `fastapi`, `uvicorn`

## Security

- API keys stored in renderer localStorage (not in env files)
- Groq API calls made from main process (key passed via IPC, not exposed to network)
- Speechmatics JWT has 120s TTL (short-lived)
- CSP restricts connections to `self` + Speechmatics WebSocket endpoints
- Context isolation enabled, sandbox disabled (required for native modules)

## Dependencies

### Production
- `better-sqlite3` — SQLite native module (requires electron-rebuild)

### Development
- `electron` 39 — Desktop runtime
- `electron-vite` 5 — Build tooling
- `svelte` 5 — UI framework
- `electron-builder` 26 — Distribution packaging

### External (Python)
- `kokoro-mlx` — Apple Silicon TTS
- `fastapi` + `uvicorn` — HTTP server
