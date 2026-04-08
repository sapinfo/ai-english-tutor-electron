import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { spawn } from 'child_process'
import icon from '../../resources/icon.png?asset'
import Database from 'better-sqlite3'

const isDev = !app.isPackaged

// ─── Kokoro TTS Server Process ───────────────────────────────────
let kokoroProcess = null

function startKokoroServer() {
  const serverPath = isDev
    ? join(process.cwd(), 'resources', 'kokoro_tts_server.py')
    : join(process.resourcesPath, 'kokoro_tts_server.py')

  console.log('[Kokoro] Starting TTS server:', serverPath)

  kokoroProcess = spawn('python3', [serverPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env, PATH: process.env.PATH + ':/usr/local/bin:/opt/homebrew/bin' }
  })

  kokoroProcess.stdout.on('data', (d) => console.log(`[Kokoro] ${d.toString().trim()}`))
  kokoroProcess.stderr.on('data', (d) => console.log(`[Kokoro] ${d.toString().trim()}`))
  kokoroProcess.unref()

  kokoroProcess.on('error', (err) => {
    console.error('[Kokoro] Failed to start:', err.message)
    kokoroProcess = null
  })

  kokoroProcess.on('close', (code) => {
    console.log(`[Kokoro] Server exited with code ${code}`)
    kokoroProcess = null
  })
}

function stopKokoroServer() {
  if (kokoroProcess) {
    try {
      process.kill(-kokoroProcess.pid, 'SIGTERM')
    } catch (_e) {
      try { kokoroProcess.kill('SIGTERM') } catch (_e2) { /* ignore */ }
    }
    kokoroProcess = null
  }
  // Also kill anything on port 8881 as fallback
  try {
    const { execSync } = require('child_process')
    const pids = execSync('lsof -ti:8881 2>/dev/null').toString().trim()
    if (pids) execSync(`kill ${pids} 2>/dev/null`)
  } catch (_e) { /* ignore */ }
}

// ─── Database ────────────────────────────────────────────────────
const DB_PATH = isDev
  ? join(process.cwd(), 'resources', 'tutor.db')
  : join(process.resourcesPath, 'tutor.db')

let _db
function getDb() {
  if (!_db) {
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')
  }
  return _db
}

// ─── Curriculum queries ──────────────────────────────────────────
function getLevelsWithLessons() {
  const db = getDb()
  const levels = db.prepare('SELECT * FROM levels ORDER BY id').all()
  const lessons = db.prepare('SELECT * FROM lessons ORDER BY level_id, sort_order').all()
  return levels.map((level) => ({
    ...level,
    lessons: lessons.filter((l) => l.level_id === level.id)
  }))
}

function getLessonWithSections(lessonId) {
  const db = getDb()
  const lesson = db
    .prepare(
      `SELECT l.*, lv.title as level_title, lv.cefr
     FROM lessons l JOIN levels lv ON l.level_id = lv.id
     WHERE l.id = ?`
    )
    .get(lessonId)
  if (!lesson) return null

  const sections = db
    .prepare('SELECT * FROM sections WHERE lesson_id = ? ORDER BY sort_order')
    .all(lessonId)
  sections.forEach((s) => {
    s.examples = s.examples ? JSON.parse(s.examples) : []
    s.vocabulary = s.vocabulary ? JSON.parse(s.vocabulary) : []
  })
  return { ...lesson, sections }
}

function buildLessonContext(lessonId, sectionIndex) {
  const lesson = getLessonWithSections(lessonId)
  if (!lesson) return null
  const section = lesson.sections[sectionIndex] || lesson.sections[0]
  return {
    lessonTitle: lesson.title,
    lessonGoal: lesson.goal,
    grammarFocus: lesson.grammar_focus,
    levelTitle: lesson.level_title,
    cefr: lesson.cefr,
    currentSection: {
      index: sectionIndex,
      total: lesson.sections.length,
      type: section.type,
      title: section.title,
      teacherScript: section.teacher_script,
      examples: section.examples,
      practicePrompt: section.practice_prompt,
      vocabulary: section.vocabulary
    }
  }
}

// ─── Groq Chat ───────────────────────────────────────────────────
const BASE_PROMPT = `You are Ms. Sarah, a professional English teacher with 20 years of experience teaching ESL/EFL students. You hold a TESOL certification and a Master's degree in Applied Linguistics. You specialize in teaching Korean-speaking adults.

## Your Personality
- Warm, patient, and genuinely encouraging
- You are supportive but not excessive — a brief "Good" or "That's right" is enough. Do NOT praise every single response. Save enthusiastic praise for genuine breakthroughs only
- You never make students feel embarrassed about mistakes — mistakes are learning opportunities
- You have a gentle sense of humor to keep lessons fun

## CRITICAL: Teaching Style — Lecture-First Approach (70% teaching, 30% student participation)
- You are the TEACHER. Your primary job is to EXPLAIN and TEACH, not to interview the student.
- The student is a beginner who came to LEARN from you. Do NOT treat them like a native speaker.
- DO NOT bombard the student with questions. Ask only simple, easy questions occasionally.
- Your responses should be mostly EXPLANATIONS with examples, not questions.

### How to teach:
1. EXPLAIN the grammar point or expression clearly with 2-3 example sentences
2. SHOW example sentences the student can learn from
3. Ask the student to TRY repeating or making a simple sentence (only after you've explained)
4. When the student responds, briefly acknowledge and teach the NEXT point
5. If the student makes an error, gently correct by showing the right way, then continue teaching

### What NOT to do:
- Do NOT ask open-ended questions without teaching first
- Do NOT ask multiple questions in one response
- Do NOT assume the student knows vocabulary or grammar you haven't taught yet
- Do NOT have long back-and-forth Q&A sessions — keep teaching new content

## Corrective Recast
- When a student makes an error, naturally repeat their sentence correctly within your response

## Language Rules
- ALWAYS respond in English only
- You understand Korean, but if the student speaks Korean, say: "I understood that! Let me teach you how to say it in English: [translation]. Try saying it!"
- Never break character — you are always Ms. Sarah the English teacher
- Keep each response to 3-5 sentences

## Noise Handling
- The student's speech is captured by a microphone and converted to text by speech recognition
- Sometimes background noise gets transcribed as random words or meaningless fragments
- If the input looks like background noise, simply respond: "I didn't quite catch that. Could you say it again?"`

function buildSystemPrompt(lessonId, sectionIndex) {
  if (!lessonId) return BASE_PROMPT

  const context = buildLessonContext(lessonId, sectionIndex || 0)
  if (!context) return BASE_PROMPT

  const s = context.currentSection
  const examplesText = s.examples.length > 0 ? s.examples.join('\n  ') : 'None'
  const vocabText = s.vocabulary.length > 0 ? s.vocabulary.join(', ') : 'None'

  return `${BASE_PROMPT}

## CURRENT LESSON
- Level: ${context.levelTitle} (CEFR ${context.cefr})
- Lesson: ${context.lessonTitle}
- Goal: ${context.lessonGoal}
- Grammar focus: ${context.grammarFocus}
- Topic boundary: This lesson is ONLY about "${context.lessonTitle}". Do NOT mix in other topics.

## CURRENT SECTION (${s.index + 1} of ${s.total}): ${s.title} [${s.type}]

### Your Teaching Script for this section:
${s.teacherScript}

### Examples to teach:
  ${examplesText}

### Vocabulary for this section:
${vocabText}

### Practice prompt (use when ready):
${s.practicePrompt || 'Continue the conversation naturally.'}

## PRIORITY (MOST IMPORTANT to least)
1. Follow the Teaching Script EXACTLY
2. Stay on THIS section's topic ONLY
3. Use ONLY the provided examples and vocabulary
4. Keep responses 3-5 sentences

## SECTION RULES
- Follow your Teaching Script above
- IMPORTANT: Take your time with this section. Do NOT rush through the content.
- Show examples ONE AT A TIME: explain one example -> let the student practice it -> then move to the next example
- Do NOT show all examples at once or summarize them quickly
- When the student responds, briefly acknowledge and use the Practice Prompt to let them try
- FORBIDDEN: Do NOT use examples or vocabulary from other lessons or topics.
- If the student brings up an off-topic subject, briefly acknowledge it, then redirect.
- Do NOT suggest moving to the next section or say goodbye/wrap up.
- Do NOT say things like "Excellent work today!", "That's all for today", or "We've covered everything"
- If you've covered all the material in this section, use the Practice Prompt to do MORE practice.
- Follow this flow: Explain (from script) -> Show ONE example -> Student tries -> Acknowledge/Correct -> Show NEXT example -> Repeat`
}

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions'

async function chatGroq(apiKey, message, history, lessonId, sectionIndex) {
  const systemPrompt = buildSystemPrompt(lessonId, sectionIndex)
  const messages = [{ role: 'system', content: systemPrompt }]

  for (const msg of history || []) {
    if (msg.role === 'teacher') messages.push({ role: 'assistant', content: msg.text })
    else if (msg.role === 'student') messages.push({ role: 'user', content: msg.text })
  }
  messages.push({ role: 'user', content: message })

  const response = await fetch(GROQ_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages,
      temperature: 0.7,
      max_tokens: 350
    })
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Groq error ${response.status}: ${errText}`)
  }
  const data = await response.json()
  return data.choices?.[0]?.message?.content || 'No response'
}

// ─── Groq Whisper STT ────────────────────────────────────────────
const GROQ_STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'

async function sttGroq(apiKey, audioBuffer) {
  const { FormData, Blob } = await import('node:buffer')
    .then(() => ({ FormData: globalThis.FormData, Blob: globalThis.Blob }))

  const blob = new Blob([audioBuffer], { type: 'audio/webm' })
  const formData = new FormData()
  formData.append('file', blob, 'audio.webm')
  formData.append('model', 'whisper-large-v3-turbo')
  formData.append('language', 'en')

  const response = await fetch(GROQ_STT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Groq STT error ${response.status}: ${errText}`)
  }
  const data = await response.json()
  return data.text || ''
}

// ─── Speechmatics JWT ────────────────────────────────────────────
async function getSpeechmaticsJwt(apiKey) {
  const response = await fetch('https://mp.speechmatics.com/v1/api_keys?type=rt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ ttl: 120 })
  })
  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Speechmatics JWT error ${response.status}: ${errText}`)
  }
  const data = await response.json()
  return data.key_value
}

// ─── Kokoro TTS ──────────────────────────────────────────────────
const KOKORO_URL = 'http://localhost:8881'

async function kokoroTts(text, voice = 'af_sarah', speed = 1.0) {
  const response = await fetch(`${KOKORO_URL}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: text, voice, response_format: 'wav', speed })
  })
  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Kokoro TTS error: ${errText}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

// ─── Window ──────────────────────────────────────────────────────
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ─── App lifecycle ───────────────────────────────────────────────
app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.electron')
  }

  app.on('browser-window-created', (_, window) => {
    // F12 for devtools in dev
    if (isDev) {
      window.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12') {
          window.webContents.toggleDevTools()
          event.preventDefault()
        }
      })
    }
  })

  // ── IPC handlers ──
  ipcMain.handle('db:getLevelsWithLessons', () => getLevelsWithLessons())

  ipcMain.handle('db:getLessonWithSections', (_e, lessonId) => getLessonWithSections(lessonId))

  ipcMain.handle('db:getProgress', (_e, studentId) => {
    const db = getDb()
    return db
      .prepare(
        'SELECT lesson_id, section_index, completed, score, updated_at FROM progress WHERE student_id = ?'
      )
      .all(studentId || 'default')
  })

  ipcMain.handle('db:saveProgress', (_e, { studentId, lessonId, sectionIndex, completed }) => {
    const db = getDb()
    const sid = studentId || 'default'
    const existing = db
      .prepare('SELECT id FROM progress WHERE student_id = ? AND lesson_id = ?')
      .get(sid, lessonId)

    if (existing) {
      db.prepare(
        `UPDATE progress SET section_index = ?, completed = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(sectionIndex || 0, completed ? 1 : 0, existing.id)
    } else {
      db.prepare(
        'INSERT INTO progress (student_id, lesson_id, section_index, completed) VALUES (?, ?, ?, ?)'
      ).run(sid, lessonId, sectionIndex || 0, completed ? 1 : 0)
    }
    return { ok: true }
  })

  ipcMain.handle('chat:groq', async (_e, { apiKey, message, history, lessonId, sectionIndex }) => {
    return await chatGroq(apiKey, message, history, lessonId, sectionIndex)
  })

  ipcMain.handle('tts:kokoro', async (_e, { text, voice, speed }) => {
    const buffer = await kokoroTts(text, voice, speed)
    return buffer
  })

  ipcMain.handle('stt:speechmatics-jwt', async (_e, { apiKey }) => {
    return await getSpeechmaticsJwt(apiKey)
  })

  ipcMain.handle('tts:kokoro-status', async () => {
    try {
      const res = await fetch('http://localhost:8881/health')
      if (res.ok) return 'running'
    } catch (_e) { /* ignore */ }
    return kokoroProcess ? 'starting' : 'stopped'
  })

  ipcMain.handle('tts:kokoro-start', () => {
    stopKokoroServer()
    startKokoroServer()
    return true
  })

  ipcMain.handle('tts:kokoro-stop', () => {
    stopKokoroServer()
    return true
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopKokoroServer()
  if (_db) {
    _db.close()
    _db = null
  }
})
