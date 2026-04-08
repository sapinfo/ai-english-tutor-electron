"""
Kokoro TTS Server (Cross-Platform)
===================================
Apple Silicon: kokoro-mlx (MLX GPU 가속)
Intel Mac / Windows / Linux: kokoro (ONNX CPU/GPU)

- 포트: 8881
- API: OpenAI TTS API 호환 형식 (/v1/audio/speech)
"""

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
import io
import soundfile as sf
import numpy as np
import time
import platform
import sys

app = FastAPI(title="Kokoro TTS Server", version="2.0.0")

# ============================================================
# 플랫폼 감지 및 모델 로딩
# ============================================================
print("Loading Kokoro TTS model...")
start = time.time()

tts = None
engine = "unknown"

# Apple Silicon 감지
is_apple_silicon = (
    platform.system() == "Darwin" and platform.machine() == "arm64"
)

if is_apple_silicon:
    try:
        from kokoro_mlx import KokoroTTS
        tts = KokoroTTS.from_pretrained()
        engine = "kokoro-mlx (Apple Silicon)"
    except ImportError:
        print("[WARN] kokoro-mlx not found, falling back to ONNX...")

if tts is None:
    try:
        from kokoro import KokoroTTS
        # GPU 감지: CUDA 사용 가능하면 cuda, 아니면 cpu
        device = "cpu"
        try:
            import onnxruntime as ort
            providers = ort.get_available_providers()
            if "CUDAExecutionProvider" in providers:
                device = "cuda"
        except Exception:
            pass
        tts = KokoroTTS.from_pretrained("hexgrad/Kokoro-82M", device=device)
        engine = f"kokoro-onnx ({device})"
    except ImportError:
        print("[ERROR] Neither kokoro-mlx nor kokoro is installed!")
        print("  Apple Silicon: pip install kokoro-mlx")
        print("  Other:         pip install kokoro onnxruntime")
        sys.exit(1)

elapsed = time.time() - start
print(f"Model loaded in {elapsed:.1f}s (engine: {engine})")
print(f"Available voices: {', '.join(tts.list_voices()[:10])}...")


# ============================================================
# 요청 스키마
# ============================================================
class SpeechRequest(BaseModel):
    input: str
    voice: str = "af_sarah"
    speed: float = 1.0
    response_format: str = "wav"


# ============================================================
# API 엔드포인트
# ============================================================
@app.post("/v1/audio/speech")
async def create_speech(request: SpeechRequest):
    if not request.input or not request.input.strip():
        raise HTTPException(status_code=400, detail="Input text is required")

    try:
        start = time.time()
        result = tts.generate(
            text=request.input,
            voice=request.voice,
            speed=request.speed
        )
        gen_time = time.time() - start
        print(f"Generated {len(request.input)} chars in {gen_time:.2f}s (voice={request.voice})")

        buf = io.BytesIO()
        audio_data = np.array(result.audio, dtype=np.float32)
        sf.write(buf, audio_data, result.sample_rate, format="WAV")
        buf.seek(0)

        return Response(
            content=buf.read(),
            media_type="audio/wav",
            headers={"X-Generation-Time": f"{gen_time:.2f}s"}
        )
    except Exception as e:
        print(f"TTS error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/audio/voices")
async def list_voices():
    return tts.list_voices()


@app.get("/health")
async def health():
    return {"status": "ok", "engine": engine}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8881)
