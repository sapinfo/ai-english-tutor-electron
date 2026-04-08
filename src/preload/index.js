import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Database
  getLevelsWithLessons: () => ipcRenderer.invoke('db:getLevelsWithLessons'),
  getLessonWithSections: (lessonId) => ipcRenderer.invoke('db:getLessonWithSections', lessonId),
  getProgress: (studentId) => ipcRenderer.invoke('db:getProgress', studentId),
  saveProgress: (data) => ipcRenderer.invoke('db:saveProgress', data),

  // Groq Chat
  chatGroq: (data) => ipcRenderer.invoke('chat:groq', data),

  // Kokoro TTS — returns Buffer (Uint8Array in renderer)
  ttsKokoro: (data) => ipcRenderer.invoke('tts:kokoro', data),

  // Speechmatics — get JWT for real-time STT
  getSpeechmaticsJwt: (data) => ipcRenderer.invoke('stt:speechmatics-jwt', data),

  // Kokoro TTS server management
  getKokoroStatus: () => ipcRenderer.invoke('tts:kokoro-status'),
  startKokoro: () => ipcRenderer.invoke('tts:kokoro-start'),
  stopKokoro: () => ipcRenderer.invoke('tts:kokoro-stop'),

  // Kokoro error events
  onKokoroError: (callback) => ipcRenderer.on('kokoro:error', (_e, msg) => callback(msg))
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.api = api
}
