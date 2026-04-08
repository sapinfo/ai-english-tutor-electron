# AI English Tutor

[English](README.en.md)

AI 기반 음성 영어 학습 데스크톱 앱입니다. 가상 영어 선생님 Ms. Sarah와 실시간 음성 대화로 영어를 연습하세요.

## 주요 기능

- **실시간 음성 대화** — AI 영어 선생님과 마이크로 대화
- **58개 구조화된 레슨** — 6단계 (A1 초급 → B2+ 비즈니스)
- **섹션별 진도 저장** — 이어서 학습 가능
- **고품질 음성 인식** — Speechmatics 실시간 API
- **자연스러운 음성 합성** — Kokoro MLX (Apple Silicon 네이티브)
- **빠른 AI 응답** — Groq (Llama 4 Scout)

## 기술 스택

| 구성 요소 | 기술 |
|-----------|------|
| 데스크톱 | Electron 39 + Vite 7 |
| UI | Svelte 5 |
| 음성 인식 (STT) | Speechmatics Real-time WebSocket |
| AI 대화 (LLM) | Groq API (Llama 4 Scout 17B) |
| 음성 합성 (TTS) | Kokoro MLX (로컬, Apple Silicon) |
| 데이터베이스 | SQLite (better-sqlite3) |

## 사전 요구 사항

- **Node.js** 18 이상
- **Python** 3.12 이상
- **Kokoro TTS** — 플랫폼별 설치 필요 → **[Kokoro TTS 설치 가이드](docs/KOKORO_SETUP.md)**

| 플랫폼 | TTS 패키지 | GPU 가속 | 속도 |
|--------|-----------|---------|------|
| macOS (Apple Silicon) | `kokoro-mlx` | MLX (자동) | ~0.5초 |
| macOS (Intel) | `kokoro` + `onnxruntime` | 없음 | ~2초 |
| Windows | `kokoro` + `onnxruntime-gpu` | NVIDIA CUDA | ~0.5-3초 |
| Linux | `kokoro` + `onnxruntime-gpu` | NVIDIA CUDA | ~0.5-3초 |

## API 키 (무료)

| 서비스 | URL | 무료 |
|--------|-----|------|
| Groq | https://console.groq.com | 넉넉한 무료 티어 |
| Speechmatics | https://portal.speechmatics.com | 무료 사용 가능 |

## 설치 및 실행

```bash
# 클론
git clone https://github.com/sapinfo/ai-english-tutor-electron.git
cd AIEnglishTutor-Electron

# 설치
npm install
npx electron-rebuild -f -w better-sqlite3

# 실행 (Terminal.app 사용, VSCode 터미널 X)
npm run dev
```

## 사용 방법

### 최초 1회: API 키 설정
1. 앱 실행
2. 우측 상단 **Settings** 클릭
3. **Groq** API 키 입력 (console.groq.com에서 발급)
4. **Speechmatics** API 키 입력 (portal.speechmatics.com에서 발급)
5. **Save** 클릭

### 매 사용 시: 순서대로 진행

```
① TTS Start  →  ② 레슨 선택  →  ③ Start  →  학습  →  ④ End Lesson  →  ⑤ TTS Stop
```

| 순서 | 동작 | 설명 |
|------|------|------|
| ① | **TTS Start** 클릭 | 음성 합성 서버 시작 (TTS: On 될 때까지 대기) |
| ② | 레슨 선택 | 원하는 레슨 카드 클릭 (또는 Free Talk) |
| ③ | **Start** 클릭 | 마이크 활성화, Ms. Sarah가 인사하며 수업 시작 |
| | 영어로 대화 | Ms. Sarah가 가르치고, 교정하고, 연습시킵니다 |
| | **Next Section →** | 다음 섹션으로 이동 (선택) |
| ④ | **End Lesson** 클릭 | 수업 종료, 진도 자동 저장 |
| ⑤ | **TTS Stop** 클릭 | 음성 합성 서버 종료 (리소스 해제) |

> **중요**: TTS 서버는 메모리를 ~200MB 사용합니다. 학습이 끝나면 반드시 **TTS Stop**을 눌러 종료해주세요.

### 수업 중 컨트롤

| 버튼 | 기능 |
|------|------|
| 🎤 / 🎙️ | 마이크 음소거/해제 |
| 🔊 / 🔇 | 음성 합성 켜기/끄기 (TTS 서버는 유지) |

## 다운로드

[Releases 페이지](https://github.com/sapinfo/ai-english-tutor-electron/releases)에서 플랫폼별 설치 파일을 다운로드하세요.

| 플랫폼 | 파일 |
|--------|------|
| macOS | `.dmg` |
| Windows | `.exe` (NSIS 설치 파일) |
| Linux | `.AppImage`, `.deb` |

## 빌드 (개발자용)

```bash
npm run build:mac    # macOS DMG
npm run build:win    # Windows 설치 파일
npm run build:linux  # Linux AppImage, deb
```

GitHub에 태그를 푸시하면 GitHub Actions가 자동으로 3개 플랫폼 빌드 후 Release에 게시합니다.

## 프로젝트 구조

```
src/
├── main/index.js           # Electron 메인 (DB, API, Kokoro 관리)
├── preload/index.js        # IPC 브릿지
└── renderer/src/
    ├── App.svelte          # 전체 UI
    └── assets/             # CSS
resources/
├── tutor.db                # 커리큘럼 데이터베이스
└── kokoro_tts_server.py    # Kokoro TTS 서버
docs/
└── ARCHITECTURE.md         # 기술 아키텍처
```

## 후원

이 프로젝트가 도움이 되셨다면 커피 한 잔 사주세요!

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/inseokko)

## 라이선스

MIT
