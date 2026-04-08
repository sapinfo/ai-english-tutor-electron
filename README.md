# AI English Tutor

[한국어](README.ko.md)

A desktop voice-based English learning app powered by AI. Practice real-time conversations with Ms. Sarah, your virtual ESL teacher.

## Features

- **Real-time voice conversation** with an AI English teacher
- **58 structured lessons** across 6 levels (A1 Beginner → B2+ Business)
- **Section-by-section progress** with automatic saving
- **High-quality STT** via Speechmatics real-time API
- **Natural TTS** via Kokoro MLX (Apple Silicon native)
- **Fast LLM responses** via Groq (Llama 4 Scout)

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Desktop | Electron 39 + Vite 7 |
| UI | Svelte 5 |
| STT | Speechmatics Real-time WebSocket |
| LLM | Groq API (Llama 4 Scout 17B) |
| TTS | Kokoro MLX (local, Apple Silicon) |
| Database | SQLite (better-sqlite3) |

## Prerequisites

- **macOS** with Apple Silicon (M1/M2/M3/M4) — required for Kokoro MLX
- **Node.js** 18+
- **Python** 3.12+ with pip packages:
  ```bash
  pip install kokoro-mlx fastapi uvicorn soundfile numpy
  ```

## API Keys (Free Tier)

| Service | URL | Free Tier |
|---------|-----|-----------|
| Groq | https://console.groq.com | Generous free tier |
| Speechmatics | https://portal.speechmatics.com | Free usage available |

## Setup

```bash
# Clone
git clone https://github.com/your-username/AIEnglishTutor-Electron.git
cd AIEnglishTutor-Electron

# Install
npm install
npx electron-rebuild -f -w better-sqlite3

# Run (use Terminal.app, NOT VSCode terminal)
npm run dev
```

## Usage

1. Launch the app with `npm run dev`
2. Click **Settings** and enter your Groq and Speechmatics API keys
3. Click **TTS Start** button and wait for "TTS: On" status
4. Select a lesson (or Free Talk)
5. Click **Start** and begin speaking in English
6. Ms. Sarah will teach, correct, and guide you through the lesson

## Controls

| Button | Function |
|--------|----------|
| TTS Start/Stop | Start or stop Kokoro TTS server |
| Start / End Lesson | Begin or end a lesson session |
| Next Section → | Advance to next lesson section |
| 🎤 / 🎙️ | Mute/unmute microphone |
| 🔊 / 🔇 | Enable/disable TTS playback |

## Build

```bash
npm run build:mac    # macOS DMG
npm run build:win    # Windows installer
npm run build:linux  # Linux AppImage
```

## Project Structure

```
src/
├── main/index.js           # Electron main (DB, APIs, Kokoro management)
├── preload/index.js        # IPC bridge
└── renderer/src/
    ├── App.svelte          # Full UI
    └── assets/             # CSS
resources/
├── tutor.db                # Curriculum database
└── kokoro_tts_server.py    # Kokoro TTS server
docs/
└── ARCHITECTURE.md         # Technical architecture
```

## License

MIT
