"""
Kokoro MLX TTS Server
=====================
Apple Silicon 네이티브 TTS 서버.
kokoro-mlx 라이브러리를 사용하여 텍스트를 음성으로 변환합니다.

- 모델: mlx-community/Kokoro-82M (4bit quantized)
- 프레임워크: FastAPI + Uvicorn
- 포트: 8881 (Docker Kokoro 8880과 분리)
- API: OpenAI TTS API 호환 형식 (/v1/audio/speech)

사용처: AIEnglishTutor 프로젝트의 선생님(Ms. Sarah) 음성 생성
"""

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from kokoro_mlx import KokoroTTS
import io
import soundfile as sf
import numpy as np
import time

# ============================================================
# FastAPI 앱 초기화
# ============================================================
app = FastAPI(title="Kokoro MLX TTS Server", version="1.0.0")

# ============================================================
# 모델 로딩 (서버 시작 시 1회)
# - 최초 실행: ~16초 (모델 다운로드 + 캐싱)
# - 이후 실행: ~3초 (캐시에서 로딩)
# - 모델 크기: ~50MB (4bit quantized)
# ============================================================
print("Loading Kokoro MLX model...")
start = time.time()
tts = KokoroTTS.from_pretrained()  # HuggingFace에서 자동 다운로드
print(f"Model loaded in {time.time()-start:.1f}s")
print(f"Available voices: {', '.join(tts.list_voices()[:10])}...")


# ============================================================
# 요청 스키마
# ============================================================
class SpeechRequest(BaseModel):
    """OpenAI TTS API 호환 요청 형식"""
    input: str                          # 변환할 텍스트
    voice: str = "af_sarah"             # 음성 이름 (기본: af_sarah)
    speed: float = 1.0                  # 속도 배율 (0.25 ~ 4.0)
    response_format: str = "wav"        # 응답 포맷 (wav)


# ============================================================
# API 엔드포인트
# ============================================================

@app.post("/v1/audio/speech")
async def create_speech(request: SpeechRequest):
    """
    텍스트를 음성으로 변환하여 WAV 오디오로 반환.

    - input: 변환할 텍스트 (필수)
    - voice: 음성 이름 (af_sarah, af_bella, am_adam 등)
    - speed: 속도 배율 (1.0 = 정상)
    - 응답 헤더 X-Generation-Time에 생성 소요 시간 포함
    """
    if not request.input or not request.input.strip():
        raise HTTPException(status_code=400, detail="Input text is required")

    try:
        # 음성 생성 (MLX 가속, Apple Silicon GPU 활용)
        start = time.time()
        result = tts.generate(
            text=request.input,
            voice=request.voice,
            speed=request.speed
        )
        gen_time = time.time() - start
        print(f"Generated {len(request.input)} chars in {gen_time:.2f}s (voice={request.voice})")

        # numpy 배열 → WAV 바이너리 변환
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
    """사용 가능한 음성 목록 반환."""
    return tts.list_voices()


@app.get("/health")
async def health():
    """서버 상태 확인용 헬스체크."""
    return {"status": "ok", "engine": "kokoro-mlx", "device": "Apple Silicon"}


# ============================================================
# 직접 실행 시 Uvicorn 서버 시작
# ============================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8881)
