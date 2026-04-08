# Kokoro TTS 서버 설치 가이드

[English](#english)

AI English Tutor의 음성 합성(TTS) 서버 설치 및 설정 가이드입니다.
Kokoro TTS는 로컬에서 실행되며, 인터넷 없이도 고품질 영어 음성을 생성합니다.

---

## 목차
- [macOS (Apple Silicon)](#macos-apple-silicon) — 권장, 최고 성능
- [macOS (Intel)](#macos-intel)
- [Windows](#windows)
- [Linux](#linux)
- [공통: 서버 테스트](#공통-서버-테스트)
- [문제 해결](#문제-해결)
- [음성 목록](#음성-목록)

---

## macOS (Apple Silicon)

M1/M2/M3/M4 칩 사용 Mac. MLX 프레임워크로 GPU 가속되어 **가장 빠릅니다**.

### 1. Python 설치 확인

```bash
python3 --version
# Python 3.12 이상 필요
```

없으면:
```bash
brew install python@3.12
```

### 2. 패키지 설치

```bash
pip install kokoro-mlx fastapi uvicorn soundfile numpy
```

### 3. 서버 실행

앱 내 **TTS Start** 버튼을 클릭하면 자동으로 실행됩니다.

수동 실행:
```bash
cd /path/to/ai-english-tutor-electron
python3 resources/kokoro_tts_server.py
```

### 4. 최초 실행

- 모델 자동 다운로드 (~50MB, HuggingFace에서)
- 최초: ~15초 소요
- 이후: ~3초 소요 (캐시)
- 메모리: ~200MB

---

## macOS (Intel)

Intel Mac에서는 `kokoro-mlx`가 작동하지 않습니다.
ONNX 기반 `kokoro` 패키지를 사용합니다.

### 1. 패키지 설치

```bash
pip install kokoro soundfile numpy fastapi uvicorn
pip install onnxruntime  # CPU 추론
```

### 2. 서버 파일 수정

`resources/kokoro_tts_server.py`를 아래와 같이 수정합니다:

```python
# 변경 전
from kokoro_mlx import KokoroTTS
tts = KokoroTTS.from_pretrained()

# 변경 후
from kokoro import KokoroTTS
tts = KokoroTTS.from_pretrained("hexgrad/Kokoro-82M", device="cpu")
```

### 3. 서버 실행

```bash
python3 resources/kokoro_tts_server.py
```

> 참고: Intel Mac에서는 GPU 가속이 없어 음성 생성이 1-3초 소요될 수 있습니다.

---

## Windows

### 1. Python 설치

[python.org](https://www.python.org/downloads/)에서 Python 3.12+ 다운로드 설치.

설치 시 **"Add Python to PATH"** 체크 필수.

```powershell
python --version
# Python 3.12.x 확인
```

### 2. 패키지 설치

```powershell
pip install kokoro soundfile numpy fastapi uvicorn
pip install onnxruntime        # CPU만 사용
# 또는
pip install onnxruntime-gpu    # NVIDIA GPU 가속 (CUDA 필요)
```

#### NVIDIA GPU 사용 시 (선택)
- [CUDA Toolkit 12.x](https://developer.nvidia.com/cuda-downloads) 설치
- [cuDNN](https://developer.nvidia.com/cudnn) 설치
- `pip install onnxruntime-gpu`

### 3. 서버 파일 수정

`resources/kokoro_tts_server.py`를 수정합니다:

```python
# 변경 전
from kokoro_mlx import KokoroTTS
tts = KokoroTTS.from_pretrained()

# 변경 후
from kokoro import KokoroTTS

# GPU 사용 (NVIDIA)
tts = KokoroTTS.from_pretrained("hexgrad/Kokoro-82M", device="cuda")
# 또는 CPU만 사용
# tts = KokoroTTS.from_pretrained("hexgrad/Kokoro-82M", device="cpu")
```

### 4. 서버 실행

```powershell
python resources/kokoro_tts_server.py
```

> 주의: Windows에서는 앱의 "TTS Start" 버튼이 `python3`를 호출합니다.
> Windows에서 `python3`가 없으면 `python`으로 대체해야 합니다.
> `src/main/index.js`에서 `'python3'`를 `'python'`으로 변경하세요.

### 5. 방화벽

Windows Defender 방화벽에서 Python 허용 팝업이 뜨면 **"허용"**을 클릭하세요.
(로컬 통신만 사용하므로 "프라이빗 네트워크"만 허용해도 됩니다.)

---

## Linux

### 1. Python 설치

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install python3 python3-pip python3-venv

# Fedora
sudo dnf install python3 python3-pip
```

### 2. 패키지 설치

```bash
pip install kokoro soundfile numpy fastapi uvicorn
pip install onnxruntime        # CPU
# 또는
pip install onnxruntime-gpu    # NVIDIA GPU (CUDA 필요)
```

#### libsndfile 필요 (soundfile 의존성)
```bash
# Ubuntu/Debian
sudo apt install libsndfile1

# Fedora
sudo dnf install libsndfile
```

### 3. 서버 파일 수정

Windows와 동일하게 `resources/kokoro_tts_server.py` 수정:

```python
# 변경 전
from kokoro_mlx import KokoroTTS
tts = KokoroTTS.from_pretrained()

# 변경 후
from kokoro import KokoroTTS
tts = KokoroTTS.from_pretrained("hexgrad/Kokoro-82M", device="cpu")
# NVIDIA GPU: device="cuda"
```

### 4. 서버 실행

```bash
python3 resources/kokoro_tts_server.py
```

---

## 공통: 서버 테스트

서버가 실행 중인지 확인:

```bash
curl http://localhost:8881/health
# {"status":"ok","engine":"kokoro-mlx","device":"Apple Silicon"}
```

음성 생성 테스트:

```bash
curl -X POST http://localhost:8881/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{"input":"Hello, how are you today?","voice":"af_sarah"}' \
  -o test.wav
```

`test.wav` 파일을 재생하여 음성이 정상적으로 생성되는지 확인합니다.

사용 가능한 음성 목록:

```bash
curl http://localhost:8881/v1/audio/voices
```

---

## 문제 해결

### "ModuleNotFoundError: No module named 'kokoro_mlx'"
- Apple Silicon이 아닌 환경에서 발생합니다.
- 위 가이드에 따라 `kokoro` (ONNX) 패키지를 설치하고 서버 파일을 수정하세요.

### "ModuleNotFoundError: No module named 'kokoro'"
```bash
pip install kokoro
```

### 모델 다운로드 실패
```bash
# HuggingFace 캐시 삭제 후 재시도
rm -rf ~/.cache/huggingface/hub/models--hexgrad--Kokoro*
rm -rf ~/.cache/huggingface/hub/models--mlx-community--Kokoro*
```

### 포트 8881이 이미 사용 중
```bash
# macOS/Linux
lsof -ti:8881 | xargs kill

# Windows (PowerShell)
netstat -ano | findstr :8881
taskkill /PID <PID번호> /F
```

### 음성 생성이 느림
| 환경 | 예상 속도 |
|------|----------|
| Apple Silicon (MLX) | ~0.5초 |
| NVIDIA GPU (ONNX) | ~0.5-1초 |
| CPU (ONNX) | ~1-3초 |

- GPU를 사용하는 다른 프로세스(Ollama 등)를 종료하면 빨라집니다.
- CPU에서 느리면 정상입니다 — 음성 품질에는 영향 없습니다.

### Windows에서 "python3를 찾을 수 없음"
Windows는 기본적으로 `python` 명령을 사용합니다.
`src/main/index.js`에서:
```javascript
// 변경 전
kokoroProcess = spawn('python3', [serverPath], {
// 변경 후
kokoroProcess = spawn('python', [serverPath], {
```

---

## 음성 목록

### 여성 (af_*)
| 음성 | 설명 |
|------|------|
| **af_sarah** | 기본 선생님 음성 (앱 기본값) |
| af_bella | 부드러운 여성 음성 |
| af_heart | 따뜻한 여성 음성 |
| af_jessica | 밝은 여성 음성 |
| af_nicole | 차분한 여성 음성 |
| af_nova | 에너지 있는 여성 음성 |
| af_river | 자연스러운 여성 음성 |
| af_sky | 밝고 가벼운 여성 음성 |

### 남성 (am_*)
| 음성 | 설명 |
|------|------|
| am_adam | 기본 남성 음성 |
| am_eric | 깊은 남성 음성 |
| am_michael | 따뜻한 남성 음성 |
| am_liam | 젊은 남성 음성 |

---

## 플랫폼별 요약

| | macOS (Apple Silicon) | macOS (Intel) | Windows | Linux |
|---|---|---|---|---|
| TTS 패키지 | `kokoro-mlx` | `kokoro` + `onnxruntime` | `kokoro` + `onnxruntime` | `kokoro` + `onnxruntime` |
| GPU 가속 | MLX (자동) | 없음 | NVIDIA CUDA (선택) | NVIDIA CUDA (선택) |
| 서버 수정 | 불필요 | 필요 | 필요 | 필요 |
| python 명령 | `python3` | `python3` | `python` | `python3` |
| 속도 | ~0.5초 | ~2초 | ~0.5-3초 | ~0.5-3초 |

---

<a id="english"></a>

# Kokoro TTS Server Setup Guide (English)

This guide covers installation and configuration of the Kokoro TTS server for AI English Tutor.
Kokoro TTS runs locally and generates high-quality English speech without internet.

## macOS (Apple Silicon) — Recommended

```bash
pip install kokoro-mlx fastapi uvicorn soundfile numpy
# Server starts automatically via "TTS Start" button in app
```

## macOS (Intel) / Windows / Linux

```bash
# Install ONNX-based Kokoro
pip install kokoro soundfile numpy fastapi uvicorn onnxruntime

# For NVIDIA GPU acceleration (optional)
pip install onnxruntime-gpu
```

Edit `resources/kokoro_tts_server.py`:
```python
# Replace:
from kokoro_mlx import KokoroTTS
tts = KokoroTTS.from_pretrained()

# With:
from kokoro import KokoroTTS
tts = KokoroTTS.from_pretrained("hexgrad/Kokoro-82M", device="cpu")  # or "cuda"
```

## Windows Note
Change `python3` to `python` in `src/main/index.js` if needed.

## Test
```bash
curl http://localhost:8881/health
curl -X POST http://localhost:8881/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{"input":"Hello!","voice":"af_sarah"}' -o test.wav
```

See the [Korean guide above](#목차) for detailed platform-specific instructions.
