<script>
  import { onMount, onDestroy } from 'svelte'

  // ─── State ─────────────────────────────────────────────────────
  let status = $state('idle') // idle | recording | connecting | error
  let errorMessage = $state('')
  let partialText = $state('')
  let micMuted = $state(false)

  // Speechmatics STT
  let sttWs = null
  let sttStream = null
  let sttAudioContext = null
  let sttProcessor = null

  // Chat
  let messages = $state([])
  let isThinking = $state(false)

  // Lesson data
  let levels = $state([])
  let selectedLessonId = $state('')
  let currentSectionIndex = $state(0)
  let showLessonPicker = $state(true)
  let lessonSections = $state([])

  // Progress
  let progressMap = $state({})

  // TTS
  let ttsEnabled = $state(true)
  let isSpeaking = $state(false)
  let audioPlayer = null
  let ttsRequestId = 0

  // Settings
  let groqApiKey = $state(localStorage.getItem('groqApiKey') || '')
  let speechmaticsApiKey = $state(localStorage.getItem('speechmaticsApiKey') || '')

  // Kokoro status
  let kokoroStatus = $state('starting') // starting | running | stopped
  let kokoroCheckInterval = null

  // Chat abort
  let chatController = null

  // Speech buffer
  let speechBuffer = ''
  let speechBufferTimer = null
  let speechDebounceMs = $state(Number(localStorage.getItem('speechDebounceMs')) || 2000)

  async function checkKokoroStatus() {
    kokoroStatus = await window.api.getKokoroStatus()
  }

  onMount(async () => {
    const [levelsData, progressData] = await Promise.all([
      window.api.getLevelsWithLessons(),
      window.api.getProgress('default')
    ])
    levels = levelsData
    for (const p of progressData) {
      progressMap[p.lesson_id] = { section_index: p.section_index, completed: p.completed }
    }
    progressMap = { ...progressMap }

    // Poll Kokoro status every 3s until running
    checkKokoroStatus()
    kokoroCheckInterval = setInterval(async () => {
      await checkKokoroStatus()
      if (kokoroStatus === 'running') {
        clearInterval(kokoroCheckInterval)
        kokoroCheckInterval = null
      }
    }, 3000)
  })

  // ─── Progress ──────────────────────────────────────────────────
  async function saveProgress(completed = false) {
    if (!selectedLessonId) return
    await window.api.saveProgress({
      lessonId: selectedLessonId,
      sectionIndex: currentSectionIndex,
      completed
    })
    progressMap[selectedLessonId] = {
      section_index: currentSectionIndex,
      completed: completed ? 1 : 0
    }
    progressMap = { ...progressMap }
  }

  // ─── TTS (Kokoro Local) ────────────────────────────────────────
  function stopAllTTS() {
    ttsRequestId++
    if (audioPlayer) {
      audioPlayer.pause()
      audioPlayer.onended = null
      audioPlayer.onerror = null
      audioPlayer = null
    }
    isSpeaking = false
  }

  async function speakText(text) {
    if (!ttsEnabled) return
    stopAllTTS()
    const myId = ttsRequestId

    isSpeaking = true
    try {
      const buffer = await window.api.ttsKokoro({ text })
      if (myId !== ttsRequestId) return

      const blob = new Blob([buffer], { type: 'audio/wav' })
      const url = URL.createObjectURL(blob)
      if (myId !== ttsRequestId) {
        URL.revokeObjectURL(url)
        return
      }

      const audio = new Audio(url)
      audioPlayer = audio
      audio.onended = () => {
        if (audioPlayer === audio) {
          isSpeaking = false
          audioPlayer = null
        }
        URL.revokeObjectURL(url)
      }
      audio.onerror = () => {
        if (audioPlayer === audio) {
          isSpeaking = false
          audioPlayer = null
        }
        URL.revokeObjectURL(url)
      }

      if (myId !== ttsRequestId) {
        URL.revokeObjectURL(url)
        return
      }
      audio.play()
    } catch (err) {
      if (myId !== ttsRequestId) return
      console.error('Kokoro TTS error:', err)
      isSpeaking = false
    }
  }

  // ─── STT (Speechmatics Real-time WebSocket) ────────────────────
  let sttRecognized = false
  let sttLastSeqNo = 0

  function extractTranscript(msg) {
    if (msg.transcript) return msg.transcript
    if (!msg.results) return ''
    return msg.results
      .map((r) => {
        if (r.alternatives && r.alternatives.length > 0) return r.alternatives[0].content || ''
        if (r.content) return r.content
        return ''
      })
      .filter(Boolean)
      .map((content, i, arr) => {
        // Handle attaches_to for punctuation
        const r = msg.results[i]
        const attaches = r.attaches_to || 'none'
        return attaches === 'none' && i > 0 ? ' ' + content : content
      })
      .join('')
  }

  async function startSpeechmaticsSTT() {
    if (!speechmaticsApiKey) {
      errorMessage = 'Please set your Speechmatics API key in Settings.'
      status = 'error'
      return
    }

    status = 'connecting'
    errorMessage = ''
    sttRecognized = false
    sttLastSeqNo = 0

    try {
      // 1. Get JWT token via main process
      const jwt = await window.api.getSpeechmaticsJwt({ apiKey: speechmaticsApiKey })

      // 2. Get microphone
      sttStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000
        }
      })

      // 3. Connect WebSocket
      sttWs = new WebSocket(`wss://eu2.rt.speechmatics.com/v2?jwt=${jwt}`)
      sttWs.binaryType = 'arraybuffer'

      sttWs.onopen = () => {
        sttWs.send(
          JSON.stringify({
            message: 'StartRecognition',
            audio_format: {
              type: 'raw',
              encoding: 'pcm_s16le',
              sample_rate: 16000
            },
            transcription_config: {
              language: 'en',
              enable_partials: true,
              max_delay: 2.0,
              operating_point: 'enhanced'
            }
          })
        )
      }

      sttWs.onmessage = (event) => {
        const data = JSON.parse(event.data)

        if (data.message === 'RecognitionStarted') {
          sttRecognized = true
          startAudioStream()
          status = 'recording'
          errorMessage = ''
          showGreeting()
        } else if (data.message === 'AudioAdded') {
          sttLastSeqNo = data.seq_no || 0
        } else if (data.message === 'AddPartialTranscript') {
          if (micMuted) return
          const text = extractTranscript(data)
          if (text && isSpeaking) stopAllTTS()
          partialText = speechBuffer ? speechBuffer + ' ' + text : text
        } else if (data.message === 'AddTranscript') {
          if (micMuted) return
          const text = extractTranscript(data)
          if (text.trim()) {
            handleCommittedText(text.trim())
          }
        } else if (data.message === 'Error') {
          console.error('Speechmatics error:', data)
          errorMessage = data.reason || 'Speechmatics STT error'
          status = 'error'
        } else if (data.message === 'EndOfTranscript') {
          console.log('Speechmatics: EndOfTranscript')
        }
      }

      sttWs.onerror = (err) => {
        console.error('Speechmatics WebSocket error:', err)
        errorMessage = 'Speechmatics connection failed'
        status = 'error'
      }

      sttWs.onclose = () => {
        sttRecognized = false
        if (status === 'recording') {
          status = 'idle'
        }
      }
    } catch (err) {
      console.error('Speechmatics start error:', err)
      errorMessage = err.message || 'Failed to start Speechmatics STT'
      status = 'error'
    }
  }

  function startAudioStream() {
    sttAudioContext = new AudioContext({ sampleRate: 16000 })
    const source = sttAudioContext.createMediaStreamSource(sttStream)

    // ScriptProcessor: capture float32 PCM → convert to int16 → send
    sttProcessor = sttAudioContext.createScriptProcessor(4096, 1, 1)
    source.connect(sttProcessor)
    sttProcessor.connect(sttAudioContext.destination)

    sttProcessor.onaudioprocess = (e) => {
      if (
        !sttRecognized ||
        status !== 'recording' ||
        micMuted ||
        !sttWs ||
        sttWs.readyState !== WebSocket.OPEN
      )
        return

      const float32 = e.inputBuffer.getChannelData(0)
      // Convert float32 → pcm_s16le
      const int16 = new Int16Array(float32.length)
      for (let i = 0; i < float32.length; i++) {
        let s = float32[i]
        if (s > 1.0) s = 1.0
        if (s < -1.0) s = -1.0
        int16[i] = s * 32767
      }
      sttWs.send(int16.buffer)
    }
  }

  function stopSpeechmaticsSTT() {
    if (sttProcessor) {
      sttProcessor.disconnect()
      sttProcessor = null
    }
    if (sttAudioContext) {
      sttAudioContext.close()
      sttAudioContext = null
    }
    if (sttStream) {
      sttStream.getTracks().forEach((t) => t.stop())
      sttStream = null
    }
    if (sttWs && sttWs.readyState === WebSocket.OPEN) {
      try {
        sttWs.send(JSON.stringify({ message: 'EndOfStream', last_seq_no: sttLastSeqNo }))
      } catch (_e) {
        /* ignore */
      }
      sttWs.close()
    }
    sttWs = null
    sttRecognized = false
    sttLastSeqNo = 0
  }

  // ─── Shared handlers ──────────────────────────────────────────
  function showGreeting() {
    if (messages.length === 0) {
      const greeting = buildGreeting()
      messages = [{ role: 'teacher', text: greeting }]
      speakText(greeting)
    }
  }

  function buildGreeting() {
    const lesson = getSelectedLesson()
    if (!lesson) {
      return "Hi there! I'm Ms. Sarah, your English teacher. Let's just chat freely today. How are you doing?"
    }
    return `Hi there! I'm Ms. Sarah. Today's lesson is "${lesson.title}." Our goal is to ${lesson.goal.toLowerCase()}. Let me start teaching you right away!`
  }

  function getSelectedLesson() {
    for (const level of levels) {
      const lesson = level.lessons.find((l) => l.id === selectedLessonId)
      if (lesson) return { ...lesson, level_title: level.title, cefr: level.cefr }
    }
    return null
  }

  // ─── Noise filter (minimal — Speechmatics is reliable) ─────────
  function handleCommittedText(text) {
    const clean = text.replace(/[.!?,;:'"]/g, '').trim()
    if (clean.length < 1) return

    stopAllTTS()

    speechBuffer += (speechBuffer ? ' ' : '') + text
    partialText = speechBuffer

    if (speechBufferTimer) clearTimeout(speechBufferTimer)
    speechBufferTimer = setTimeout(flushSpeechBuffer, speechDebounceMs)
  }

  function flushSpeechBuffer() {
    const text = speechBuffer.trim()
    speechBuffer = ''
    speechBufferTimer = null
    if (!text) return

    partialText = ''

    const lowerText = text.toLowerCase()
    if (lowerText.includes('next section')) {
      if (selectedLessonId && currentSectionIndex < (lessonSections.length || 5) - 1) {
        currentSectionIndex++
      }
    }

    messages = [...messages, { role: 'student', text }]
    sendToTeacher(text)
  }

  // ─── Chat (Groq) ──────────────────────────────────────────────
  async function sendToTeacher(studentMessage) {
    if (!groqApiKey) {
      errorMessage = 'Please set your Groq API key in Settings.'
      return
    }

    isThinking = true
    if (chatController) chatController.abort()
    chatController = new AbortController()

    try {
      const history = messages
        .filter((m) => m !== messages[messages.length - 1])
        .map((m) => ({ role: m.role, text: m.text }))

      const reply = await window.api.chatGroq({
        apiKey: groqApiKey,
        message: studentMessage,
        history,
        lessonId: selectedLessonId || null,
        sectionIndex: currentSectionIndex
      })

      if (status !== 'recording') return
      messages = [...messages, { role: 'teacher', text: reply }]
      speakText(reply)
    } catch (err) {
      console.error('Chat error:', err)
      errorMessage = err.message
      messages = [
        ...messages,
        { role: 'teacher', text: "Sorry, I didn't catch that. Could you try again?" }
      ]
    } finally {
      isThinking = false
    }
  }

  // ─── Lesson control ───────────────────────────────────────────
  async function startLesson() {
    if (!groqApiKey || !speechmaticsApiKey) {
      errorMessage = 'Please set your Groq and Speechmatics API keys in Settings.'
      return
    }
    if (kokoroStatus !== 'running') {
      errorMessage = 'TTS server is not ready. Click "TTS Start" first and wait.'
      return
    }
    showLessonPicker = false

    if (selectedLessonId) {
      const data = await window.api.getLessonWithSections(selectedLessonId)
      lessonSections = data?.sections || []
      const prog = progressMap[selectedLessonId]
      currentSectionIndex = prog && !prog.completed ? prog.section_index : 0
    } else {
      lessonSections = []
      currentSectionIndex = 0
    }

    await startSpeechmaticsSTT()
  }

  async function nextSection() {
    await saveProgress(false)
    currentSectionIndex++
    messages = [
      ...messages,
      { role: 'teacher', text: 'Moving to the next section! Let me teach you something new.' }
    ]
    sendToTeacher("I'm ready for the next section. Please start teaching.")
  }

  function goToSection(index) {
    if (index === currentSectionIndex) return
    currentSectionIndex = index
    const sectionTitle = lessonSections[index]?.title || 'this section'
    messages = [
      ...messages,
      {
        role: 'teacher',
        text: `Let's go back to "${sectionTitle}." Let me review this part for you.`
      }
    ]
    sendToTeacher(
      `The student wants to revisit section: "${sectionTitle}". Please start teaching this section from the beginning.`
    )
  }

  async function stopLesson() {
    const isCompleted = currentSectionIndex >= lessonSections.length - 1
    await saveProgress(isCompleted)

    if (chatController) {
      chatController.abort()
      chatController = null
    }
    stopAllTTS()
    status = 'idle'
    stopSpeechmaticsSTT()
    partialText = ''
    errorMessage = ''
    messages = []
    currentSectionIndex = 0
    showLessonPicker = true
  }

  onDestroy(() => {
    stopSpeechmaticsSTT()
    if (audioPlayer) {
      audioPlayer.pause()
      audioPlayer = null
    }
    if (kokoroCheckInterval) {
      clearInterval(kokoroCheckInterval)
    }
  })

  // Auto-scroll
  let chatBox = $state(null)
  $effect(() => {
    if (chatBox && messages.length) {
      chatBox.scrollTop = chatBox.scrollHeight
    }
  })

  // Settings
  let showSettings = $state(false)

  function saveApiKeys() {
    localStorage.setItem('groqApiKey', groqApiKey)
    localStorage.setItem('speechmaticsApiKey', speechmaticsApiKey)
    showSettings = false
  }
</script>

<main>
  <header>
    <h1>AI English Tutor</h1>
    {#if status === 'connecting'}
      <span class="status-badge connecting">Connecting...</span>
    {:else if status === 'recording'}
      <span class="status-badge recording">
        <span class="dot"></span>
        {micMuted ? 'Muted' : isSpeaking ? 'Speaking...' : 'Listening...'}
      </span>
    {/if}
    {#if selectedLessonId && status === 'recording'}
      <span class="section-badge">
        Section {currentSectionIndex + 1}/{lessonSections.length || '?'}
      </span>
    {/if}
    <span style="flex:1"></span>
    <button
      class="kokoro-badge {kokoroStatus}"
      onclick={async () => {
        if (kokoroStatus === 'running') {
          await window.api.stopKokoro()
          kokoroStatus = 'stopped'
        } else {
          await window.api.startKokoro()
          kokoroStatus = 'starting'
          // Poll until running
          const poll = setInterval(async () => {
            await checkKokoroStatus()
            if (kokoroStatus === 'running' || kokoroStatus === 'stopped') clearInterval(poll)
          }, 2000)
        }
      }}
    >
      TTS: {kokoroStatus === 'running' ? '● On' : kokoroStatus === 'starting' ? '◌ Loading...' : '○ Off'}
    </button>
    <button class="btn-settings" onclick={() => (showSettings = !showSettings)}>
      {showSettings ? 'Close' : 'Settings'}
    </button>
  </header>

  <!-- Settings Panel -->
  {#if showSettings}
    <div class="settings-panel">
      <div class="setting-row">
        <label for="groq-key">Groq:</label>
        <input
          id="groq-key"
          type="password"
          bind:value={groqApiKey}
          placeholder="gsk_..."
        />
      </div>
      <div class="setting-row">
        <label for="sm-key">Speechmatics:</label>
        <input
          id="sm-key"
          type="password"
          bind:value={speechmaticsApiKey}
          placeholder="API key..."
        />
      </div>
      <div class="setting-row">
        <label for="debounce">Silence Wait:</label>
        <input
          id="debounce"
          type="range"
          min="1000"
          max="8000"
          step="500"
          bind:value={speechDebounceMs}
          oninput={(e) => localStorage.setItem('speechDebounceMs', e.target.value)}
        />
        <span class="setting-value">{(speechDebounceMs / 1000).toFixed(1)}s</span>
      </div>
      <div class="setting-row" style="justify-content: flex-end;">
        <button class="btn-save" onclick={saveApiKeys}>Save</button>
      </div>
      <p class="setting-hint">
        Groq: console.groq.com | Speechmatics: portal.speechmatics.com
      </p>
    </div>
  {/if}

  <!-- Lesson Picker -->
  {#if showLessonPicker && status === 'idle'}
    <section class="lesson-picker">
      {#each levels as level}
        <div class="level-group">
          <h2 class="level-title">
            Level {level.id}: {level.title}
            <span class="cefr">{level.cefr}</span>
          </h2>
          <div class="lesson-grid">
            {#each level.lessons as lesson}
              {@const prog = progressMap[lesson.id]}
              <button
                class="lesson-card {selectedLessonId === lesson.id ? 'selected' : ''} {prog?.completed ? 'completed' : prog ? 'in-progress' : ''}"
                onclick={() => (selectedLessonId = lesson.id)}
              >
                <div class="lesson-card-header">
                  <span class="lesson-id">{lesson.id}</span>
                  {#if prog?.completed}
                    <span class="progress-badge done">Completed</span>
                  {:else if prog}
                    <span class="progress-badge ongoing">{prog.section_index + 1}/5</span>
                  {/if}
                </div>
                <span class="lesson-title">{lesson.title}</span>
                <span class="lesson-goal">{lesson.goal}</span>
              </button>
            {/each}
          </div>
        </div>
      {/each}

      <button
        class="lesson-card free-talk {selectedLessonId === '' ? 'selected' : ''}"
        onclick={() => (selectedLessonId = '')}
      >
        <span class="lesson-id">FREE</span>
        <span class="lesson-title">Free Talk</span>
        <span class="lesson-goal">No specific topic — just practice conversation</span>
      </button>
    </section>
  {/if}

  <!-- Lesson Info Bar + Section Progress -->
  {#if selectedLessonId && status === 'recording'}
    {@const lesson = getSelectedLesson()}
    {#if lesson}
      <div class="lesson-info">
        <div class="lesson-info-top">
          <strong>{lesson.title}</strong>
          <span class="lesson-info-level">{lesson.level_title} ({lesson.cefr})</span>
        </div>
        <span class="lesson-info-goal">{lesson.goal}</span>

        {#if lessonSections.length > 0}
          <div class="section-progress">
            {#each lessonSections as section, i}
              <button
                class="section-step {i < currentSectionIndex ? 'done' : i === currentSectionIndex ? 'active' : 'upcoming'}"
                onclick={() => goToSection(i)}
              >
                <span class="step-dot">
                  {#if i < currentSectionIndex}✓{:else}{i + 1}{/if}
                </span>
                <span class="step-label"
                  >{section.title.length > 15
                    ? section.title.slice(0, 15) + '...'
                    : section.title}</span
                >
              </button>
              {#if i < lessonSections.length - 1}
                <div class="step-line {i < currentSectionIndex ? 'done' : ''}"></div>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {/if}

  <!-- Chat Area -->
  <section class="chat-area" bind:this={chatBox}>
    {#if messages.length === 0 && status === 'idle' && !showLessonPicker}
      <div class="empty-state">
        <p class="emoji">🎓</p>
        <p>Press <strong>Start Lesson</strong> to begin.</p>
      </div>
    {/if}

    {#each messages as msg}
      <div class="message {msg.role}">
        <span class="label"
          >{msg.role === 'teacher' ? '🎓 Ms. Sarah' : '🎤 You'}</span
        >
        <p>{msg.text}</p>
      </div>
    {/each}

    {#if partialText}
      <div class="message student partial">
        <span class="label">🎤 You</span>
        <p>{partialText}</p>
      </div>
    {/if}

    {#if isThinking}
      <div class="message teacher thinking">
        <span class="label">🎓 Ms. Sarah</span>
        <p class="dots">Thinking<span>...</span></p>
      </div>
    {/if}
  </section>

  <!-- Error -->
  {#if errorMessage}
    <div class="error-bar">{errorMessage}</div>
  {/if}

  <!-- Controls -->
  <section class="controls">
    {#if status === 'idle' || status === 'error'}
      <button
        class="btn-kokoro {kokoroStatus}"
        onclick={async () => {
          if (kokoroStatus === 'running') {
            await window.api.stopKokoro()
            kokoroStatus = 'stopped'
          } else if (kokoroStatus !== 'starting') {
            await window.api.startKokoro()
            kokoroStatus = 'starting'
            const poll = setInterval(async () => {
              await checkKokoroStatus()
              if (kokoroStatus !== 'starting') clearInterval(poll)
            }, 2000)
          }
        }}
      >
        {kokoroStatus === 'running' ? 'TTS Stop' : kokoroStatus === 'starting' ? 'TTS Loading...' : 'TTS Start'}
      </button>
      <button class="btn-start" onclick={startLesson} disabled={kokoroStatus !== 'running'}>
        {#if selectedLessonId}
          {@const lesson = getSelectedLesson()}
          Start: {lesson?.title || 'Lesson'}
        {:else}
          Start Free Talk
        {/if}
      </button>
    {:else}
      {#if selectedLessonId && currentSectionIndex < lessonSections.length - 1}
        <button class="btn-next" onclick={nextSection}>Next Section →</button>
      {/if}
      <button class="btn-stop" onclick={stopLesson}>End Lesson</button>
      <button
        class="btn-kokoro {kokoroStatus}"
        onclick={async () => {
          if (kokoroStatus === 'running') {
            await window.api.stopKokoro()
            kokoroStatus = 'stopped'
          } else if (kokoroStatus !== 'starting') {
            await window.api.startKokoro()
            kokoroStatus = 'starting'
            const poll = setInterval(async () => {
              await checkKokoroStatus()
              if (kokoroStatus !== 'starting') clearInterval(poll)
            }, 2000)
          }
        }}
      >
        {kokoroStatus === 'running' ? 'TTS Stop' : kokoroStatus === 'starting' ? 'TTS Loading...' : 'TTS Start'}
      </button>
      <button
        class="btn-mic"
        onclick={() => {
          micMuted = !micMuted
          if (micMuted) partialText = ''
        }}
      >
        {micMuted ? '🎙️' : '🎤'}
      </button>
      <button
        class="btn-tts"
        onclick={() => {
          ttsEnabled = !ttsEnabled
          if (!ttsEnabled) stopAllTTS()
        }}
      >
        {ttsEnabled ? '🔊' : '🔇'}
      </button>
    {/if}
  </section>
</main>

<style>
  main {
    max-width: 720px;
    margin: 0 auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }

  h1 {
    font-size: 20px;
    font-weight: 700;
  }

  .kokoro-badge {
    font-size: 10px;
    padding: 3px 8px;
    border-radius: 4px;
    font-weight: 600;
  }
  .kokoro-badge.running {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
  }
  .kokoro-badge.starting {
    background: rgba(245, 158, 11, 0.15);
    color: #f59e0b;
  }
  .kokoro-badge.stopped {
    background: rgba(229, 69, 69, 0.15);
    color: var(--danger);
  }

  .btn-settings {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-dim);
    padding: 4px 12px;
    font-size: 12px;
    border-radius: 6px;
  }
  .btn-settings:hover {
    background: var(--border);
    color: var(--text);
  }

  .settings-panel {
    padding: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    margin: 8px 0;
  }

  .setting-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .setting-row label {
    font-size: 13px;
    color: var(--text-dim);
    font-weight: 600;
    white-space: nowrap;
  }

  .setting-row input {
    flex: 1;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 13px;
  }

  .setting-value {
    font-size: 13px;
    font-weight: 600;
    color: var(--accent);
    min-width: 36px;
    text-align: right;
  }

  .setting-row input[type='range'] {
    flex: 1;
    accent-color: var(--accent);
  }

  .btn-kokoro {
    flex: 1;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 600;
    border-radius: 6px;
    border: 1px solid var(--border);
  }
  .btn-kokoro.on {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
  }
  .btn-kokoro.on:hover {
    background: rgba(34, 197, 94, 0.25);
  }
  .btn-kokoro.off {
    background: rgba(229, 69, 69, 0.15);
    color: var(--danger);
  }
  .btn-kokoro.off:hover {
    background: rgba(229, 69, 69, 0.25);
  }
  .btn-kokoro.loading {
    background: rgba(245, 158, 11, 0.15);
    color: #f59e0b;
  }

  .btn-save {
    background: var(--accent);
    color: #fff;
    padding: 6px 16px;
    font-size: 13px;
  }
  .btn-save:hover {
    background: var(--accent-hover);
  }

  .setting-hint {
    font-size: 11px;
    color: var(--text-dim);
    margin-top: 6px;
    opacity: 0.7;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 999px;
  }

  .status-badge.recording {
    background: rgba(229, 69, 69, 0.15);
    color: var(--danger);
  }

  .status-badge.connecting {
    background: rgba(245, 158, 11, 0.15);
    color: #f59e0b;
  }

  .section-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--danger);
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }

  /* Lesson Picker */
  .lesson-picker {
    flex: 1;
    overflow-y: auto;
    padding: 16px 0;
  }

  .level-group {
    margin-bottom: 20px;
  }

  .level-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .cefr {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
  }

  .lesson-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .lesson-card {
    text-align: left;
    padding: 10px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 2px;
    transition: all 0.15s;
  }
  .lesson-card:hover {
    border-color: var(--accent);
  }
  .lesson-card.selected {
    border-color: var(--accent);
    background: rgba(79, 140, 255, 0.1);
  }
  .lesson-card.free-talk {
    margin-top: 12px;
    border-style: dashed;
  }

  .lesson-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .lesson-card.completed {
    border-color: #22c55e;
    background: rgba(34, 197, 94, 0.08);
  }

  .lesson-card.in-progress {
    border-color: #f59e0b;
    background: rgba(245, 158, 11, 0.08);
  }

  .progress-badge {
    font-size: 9px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 4px;
  }

  .progress-badge.done {
    background: #22c55e;
    color: #fff;
  }

  .progress-badge.ongoing {
    background: #f59e0b;
    color: #fff;
  }

  .lesson-id {
    font-size: 10px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 0.5px;
  }
  .lesson-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .lesson-goal {
    font-size: 11px;
    color: var(--text-dim);
    line-height: 1.4;
  }

  /* Lesson Info Bar */
  .lesson-info {
    padding: 8px 12px;
    background: rgba(79, 140, 255, 0.1);
    border: 1px solid rgba(79, 140, 255, 0.2);
    border-radius: 8px;
    margin: 8px 0;
  }
  .lesson-info-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .lesson-info strong {
    font-size: 13px;
    color: var(--accent);
  }
  .lesson-info-level {
    font-size: 11px;
    color: var(--text-dim);
  }
  .lesson-info-goal {
    font-size: 12px;
    color: var(--text-dim);
  }

  /* Section Progress Bar */
  .section-progress {
    display: flex;
    align-items: center;
    gap: 0;
    margin-top: 10px;
    overflow-x: auto;
  }

  .section-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    min-width: 50px;
    flex-shrink: 0;
    cursor: pointer;
    background: none;
    border: none;
    padding: 4px;
    border-radius: 6px;
    transition: background 0.15s;
  }

  .section-step:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .step-dot {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    border: 2px solid var(--border);
    background: var(--surface);
    color: var(--text-dim);
  }

  .section-step.done .step-dot {
    background: #22c55e;
    border-color: #22c55e;
    color: #fff;
  }

  .section-step.active .step-dot {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    animation: pulse 1.5s infinite;
  }

  .step-label {
    font-size: 9px;
    color: var(--text-dim);
    text-align: center;
    white-space: nowrap;
  }

  .section-step.active .step-label {
    color: var(--accent);
    font-weight: 600;
  }

  .section-step.done .step-label {
    color: #22c55e;
  }

  .step-line {
    flex: 1;
    height: 2px;
    background: var(--border);
    min-width: 12px;
    margin-bottom: 16px;
  }

  .step-line.done {
    background: #22c55e;
  }

  /* Chat */
  .chat-area {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 0 80px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .empty-state {
    text-align: center;
    padding: 60px 20px;
    color: var(--text-dim);
  }
  .empty-state .emoji {
    font-size: 48px;
    margin-bottom: 16px;
  }
  .empty-state strong {
    color: var(--accent);
  }

  .message {
    max-width: 85%;
    padding: 10px 14px;
    border-radius: 12px;
  }
  .message .label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-dim);
    display: block;
    margin-bottom: 4px;
  }
  .message p {
    font-size: 15px;
    line-height: 1.6;
  }

  .message.teacher {
    align-self: flex-start;
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .message.student {
    align-self: flex-end;
    background: var(--accent);
    color: #fff;
  }
  .message.student .label {
    color: rgba(255, 255, 255, 0.7);
  }
  .message.partial {
    opacity: 0.6;
  }

  .message.thinking .dots span {
    animation: blink 1.2s infinite;
  }
  @keyframes blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.2;
    }
  }

  /* Error */
  .error-bar {
    padding: 8px 12px;
    border-radius: 6px;
    background: rgba(229, 69, 69, 0.1);
    color: var(--danger);
    font-size: 13px;
    margin-bottom: 8px;
  }

  /* Controls */
  .controls {
    display: flex;
    gap: 8px;
    padding: 12px 0 4px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  .btn-start {
    flex: 1;
    background: var(--accent);
    color: #fff;
    font-size: 16px;
    padding: 12px;
  }
  .btn-start:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .btn-next {
    flex: 1;
    background: var(--accent);
    color: #fff;
    font-size: 14px;
    padding: 12px;
  }
  .btn-next:hover {
    background: var(--accent-hover);
  }

  .btn-stop {
    flex: 1;
    background: var(--danger);
    color: #fff;
    font-size: 16px;
    padding: 12px;
  }
  .btn-stop:hover {
    background: var(--danger-hover);
  }

  .btn-mic {
    margin-left: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    padding: 4px 8px;
    font-size: 18px;
    border-radius: 6px;
    min-width: 36px;
  }
  .btn-mic:hover {
    background: var(--border);
  }

  .btn-tts {
    background: var(--surface);
    border: 1px solid var(--border);
    padding: 4px 8px;
    font-size: 18px;
    border-radius: 6px;
    min-width: 36px;
  }
  .btn-tts:hover {
    background: var(--border);
  }

  @media (max-width: 480px) {
    .lesson-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
