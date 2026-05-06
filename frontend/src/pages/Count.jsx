import { useRef, useEffect } from 'react'
import Layout from '../components/Layout'
import BeeBackground from '../components/BeeBackground'
import api from '../api/client'
import { useWorkspace } from '../context/WorkspaceContext'
import s from './Count.module.css'

const STEPS = [
  {
    label: 'Upload',
    detail: 'Choose a phone video'
  },
  {
    label: 'Auto setup',
    detail: 'Find flight path'
  },
  {
    label: 'Process',
    detail: 'Track each crossing'
  },
  {
    label: 'Results',
    detail: 'Review and export'
  }
]

function stepToWizardIndex(step) {
  if (step >= 3) return 3
  if (step >= 2) return 2
  return step
}

const PHONE_CAPTURE_GUIDE = [
  {
    label: 'Stable phone',
    detail: 'Keep the phone fixed on a holder or tripod before recording.'
  },
  {
    label: 'Clear entrance',
    detail: 'Frame the hive entrance and leave some open air in front of it.'
  },
  {
    label: 'Even lighting',
    detail: 'Avoid strong glare, deep shadows, and sudden camera movement.'
  }
]
const COUNT_API_BASE = import.meta.env.VITE_COUNT_API_URL || '/motion-api'
const COUNT_BACKENDS = {
  yolo: {
    label: 'YOLO backend',
    path: '',
    description: 'Uses the main Flask backend and model-based detection.'
  },
  motion: {
    label: 'Motion backend',
    path: COUNT_API_BASE,
    description: 'Uses the simpler motion-only prototype on the separate backend.'
  }
}

const BEE_PROCESSING_FACTS = [
  {
    label: 'Flight pattern',
    text: 'Stingless bees often hover briefly before committing to the entrance, so the counter waits for movement into open air.'
  },
  {
    label: 'Fast motion',
    text: 'A fast bee can appear as a stretched blur across two frames; the motion backend checks those blur trails during counting.'
  },
  {
    label: 'Hive traffic',
    text: 'Entrance clusters are noisy. The safest count happens just outside the hive face, after a bee leaves the hover zone.'
  },
  {
    label: 'Foraging rhythm',
    text: 'Outgoing bees usually accelerate away from the nest, while returning bees slow down near the entrance.'
  }
]

const PROCESSING_PHASES = [
  'Reading frames',
  'Finding motion',
  'Linking tracks',
  'Checking crossings'
]

function ProgressBar({ label, percent, mode = 'determinate' }) {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent || 0)))
  return (
    <div className={s.progressCard} aria-live="polite">
      <div className={s.progressHeader}>
        <span>{label}</span>
        {mode === 'determinate' && <strong>{safePercent}%</strong>}
      </div>
      <div className={s.progressTrack} role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={mode === 'determinate' ? safePercent : undefined}>
        <div
          className={`${s.progressFill} ${mode === 'indeterminate' ? s.progressFillActive : ''}`}
          style={mode === 'determinate' ? { width: `${safePercent}%` } : undefined}
        />
      </div>
    </div>
  )
}

function countApiPath(backendMode, path) {
  const base = COUNT_BACKENDS[backendMode]?.path || ''
  return base ? `${base}${path}` : path
}

function getSetupStatus({ useRoi, roi, lineStart, lineEnd, hivePoint }) {
  if (useRoi && !roi) {
    return {
      title: 'Step 1: Draw the entrance area',
      detail: 'Drag a small box only around the place where bees actually enter and leave.',
      tip: 'Keep it tight. Do not include lots of empty sky.'
    }
  }
  if (!lineStart) {
    return {
      title: useRoi ? 'Step 2: Click the start of the counting line' : 'Step 1: Click the start of the counting line',
      detail: 'Put the line just outside the entrance, after the hover zone but before bees spread into open flight.',
      tip: 'Avoid the hive wall itself. The line should catch bees after they commit to entering or leaving.'
    }
  }
  if (!lineEnd) {
    return {
      title: useRoi ? 'Step 3: Click the end of the counting line' : 'Step 2: Click the end of the counting line',
      detail: 'Make the line cover the open-air crossing path in front of the entrance.',
      tip: 'A short line slightly away from the hive is usually better than a line through hovering bees.'
    }
  }
  if (!hivePoint) {
    return {
      title: useRoi ? 'Step 4: Mark the hive side' : 'Step 3: Mark the hive side',
      detail: 'Click on the side of the line that represents inside / hive side.',
      tip: 'Usually this point should be on the hive wall side, not in the open sky.'
    }
  }
  return {
    title: 'Setup complete',
    detail: 'The line and hive-side marker are ready.',
    tip: 'If the line is not very close to the entrance edge, reset setup and move it closer before starting.'
  }
}

function getSetupChecklist({ useRoi, roi, lineStart, lineEnd, hivePoint }) {
  return [
    {
      key: 'roi',
      label: useRoi ? 'Entrance area selected' : 'ROI skipped in quick mode',
      done: useRoi ? Boolean(roi) : true
    },
    {
      key: 'lineStart',
      label: 'Line start placed',
      done: Boolean(lineStart)
    },
    {
      key: 'lineEnd',
      label: 'Line end placed',
      done: Boolean(lineEnd)
    },
    {
      key: 'hivePoint',
      label: 'Hive-side point placed',
      done: Boolean(hivePoint)
    }
  ]
}

function getCurrentAction({ useRoi, roi, lineStart, lineEnd, hivePoint }) {
  if (useRoi && !roi) return 'Draw entrance area'
  if (!lineStart) return 'Place line start'
  if (!lineEnd) return 'Place line end'
  if (!hivePoint) return 'Mark hive side'
  return 'Ready to count'
}

export default function Count() {
  const { countSession, countSetters } = useWorkspace()
  const {
    step,
    backendMode,
    trialMode,
    videoFile,
    downloadName,
    frame,
    frameW,
    frameH,
    suggestedSetup,
    tunedSetup,
    useRoi,
    roi,
    draftRoi,
    lineStart,
    lineEnd,
    lineDraftEnd,
    hivePoint,
    result,
    error,
    dragging,
    uploading,
    progressLabel,
    progressPercent,
    progressMode,
    processingFactIndex
  } = countSession
  const {
    setStep,
    setTrialMode,
    setVideoFile,
    setDownloadName,
    setFrame,
    setFrameW,
    setFrameH,
    setSuggestedSetup,
    setTunedSetup,
    setUseRoi,
    setRoi,
    setDraftRoi,
    setLineStart,
    setLineEnd,
    setLineDraftEnd,
    setHivePoint,
    setResult,
    setError,
    setDragging,
    setUploading,
    setProgressLabel,
    setProgressPercent,
    setProgressMode,
    setProcessingFactIndex,
    resetCountSession
  } = countSetters

  const canvasRef = useRef()
  const inputRef = useRef()
  const imgRef = useRef(new Image())
  const dragRef = useRef(null)
  const suppressClickRef = useRef(false)
  const setupStatus = getSetupStatus({ useRoi, roi, lineStart, lineEnd, hivePoint })
  const checklist = getSetupChecklist({ useRoi, roi, lineStart, lineEnd, hivePoint })
  const currentAction = getCurrentAction({ useRoi, roi, lineStart, lineEnd, hivePoint })
  const setupDoneCount = checklist.filter(item => item.done).length
  const wizardStep = stepToWizardIndex(step)

  function clearLineSetup() {
    setLineStart(null)
    setLineEnd(null)
    setLineDraftEnd(null)
    setHivePoint(null)
  }

  function clearAllSetup(nextUseRoi = useRoi) {
    setUseRoi(nextUseRoi)
    setRoi(null)
    setDraftRoi(null)
    clearLineSetup()
    setError('')
  }

  function resetProgress() {
    setProgressLabel('')
    setProgressPercent(0)
    setProgressMode('determinate')
  }

  function updateUploadProgress(event, nextLabel, processingLabel) {
    if (!event.total) {
      setProgressMode('indeterminate')
      setProgressLabel(nextLabel)
      return
    }

    const nextPercent = Math.max(4, Math.min(96, Math.round((event.loaded / event.total) * 100)))
    setProgressMode('determinate')
    setProgressLabel(nextLabel)
    setProgressPercent(nextPercent)

    if (event.loaded >= event.total) {
      setProgressMode('indeterminate')
      setProgressLabel(processingLabel)
      setProgressPercent(100)
    }
  }

  function getSetupHint() {
    if (useRoi && !roi) return 'Drag a box around the hive entrance first'
    if (!lineStart) return 'Click the first point of the counting line'
    if (!lineEnd) return 'Click the second point of the counting line'
    if (!hivePoint) return 'Click once on the hive side of the line'
    return 'Automatic setup preview - check the line and hive side before counting'
  }

  function applySetup(setup) {
    if (!setup) return
    setUseRoi(false)
    setRoi(null)
    setDraftRoi(null)
    setLineStart({
      x: setup.line_x1,
      y: setup.line_y1
    })
    setLineEnd({
      x: setup.line_x2,
      y: setup.line_y2
    })
    setLineDraftEnd(null)
    setHivePoint({
      x: setup.hive_x,
      y: setup.hive_y
    })
    setResult(null)
    setError('')
  }

  useEffect(() => {
    if (!frame || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    imgRef.current.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(imgRef.current, 0, 0, canvas.width, canvas.height)
      if (roi) drawRoi(ctx, roi)
      if (draftRoi) drawRoi(ctx, draftRoi, true)
      if (lineStart && (lineEnd || lineDraftEnd)) {
        if (hivePoint) drawHiveSideArea(ctx, lineStart, lineEnd || lineDraftEnd, hivePoint)
        drawLine(ctx, lineStart, lineEnd || lineDraftEnd)
      }
      if (hivePoint) drawHivePoint(ctx, hivePoint)
    }
    imgRef.current.src = `data:image/jpeg;base64,${frame}`
  }, [frame, roi, draftRoi, lineStart, lineEnd, lineDraftEnd, hivePoint])

  useEffect(() => {
    if (step !== 2) {
      setProcessingFactIndex(0)
      return undefined
    }

    const timer = window.setInterval(() => {
      setProcessingFactIndex(index => (index + 1) % BEE_PROCESSING_FACTS.length)
    }, 5200)

    return () => window.clearInterval(timer)
  }, [step])

  function drawRoi(ctx, box, isDraft = false) {
    ctx.save()
    ctx.fillStyle = isDraft ? 'rgba(255,176,32,0.09)' : 'rgba(255,176,32,0.14)'
    ctx.strokeStyle = '#ffb020'
    ctx.lineWidth = 2
    ctx.setLineDash([8, 4])
    ctx.fillRect(box.x, box.y, box.width, box.height)
    ctx.strokeRect(box.x, box.y, box.width, box.height)
    ctx.setLineDash([])
    ctx.fillStyle = '#ffb020'
    ctx.font = 'bold 13px Sora, sans-serif'
    ctx.fillText(isDraft ? 'Drawing ROI' : 'Entrance ROI', box.x + 8, Math.max(18, box.y - 8))
    ctx.restore()
  }

  function drawLine(ctx, start, end) {
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.strokeStyle = '#00ffcc'
    ctx.lineWidth = 3
    ctx.setLineDash([10, 5])
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#00ffcc'
    ctx.font = 'bold 13px Sora, sans-serif'
    ctx.fillText('Counting line', start.x + 8, Math.max(20, start.y - 10))
    ctx.beginPath()
    ctx.arc(start.x, start.y, 4, 0, Math.PI * 2)
    ctx.arc(end.x, end.y, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  function drawHiveSideArea(ctx, start, end, point) {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy)
    if (!length) return

    const normal = {
      x: -dy / length,
      y: dx / length
    }
    const side = Math.sign((point.x - start.x) * normal.x + (point.y - start.y) * normal.y) || 1
    const offset = Math.max(frameW, frameH) * 2
    const ox = normal.x * side * offset
    const oy = normal.y * side * offset

    ctx.save()
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.lineTo(end.x + ox, end.y + oy)
    ctx.lineTo(start.x + ox, start.y + oy)
    ctx.closePath()
    ctx.fillStyle = 'rgba(82,196,138,0.16)'
    ctx.fill()
    ctx.restore()
  }

  function drawHivePoint(ctx, point) {
    ctx.save()
    ctx.fillStyle = '#52c48a'
    ctx.strokeStyle = '#07130d'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(point.x, point.y, 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = 'rgba(82,196,138,0.95)'
    ctx.fillRect(point.x + 10, Math.max(8, point.y - 28), 78, 22)
    ctx.fillStyle = '#07130d'
    ctx.font = 'bold 13px Sora, sans-serif'
    ctx.fillText('Hive side', point.x + 16, Math.max(24, point.y - 12))
    ctx.restore()
  }

  function getCanvasPoint(e) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY)
    }
  }

  function pointInRoi(point, box) {
    if (!box) return true
    return (
      point.x >= box.x &&
      point.x <= box.x + box.width &&
      point.y >= box.y &&
      point.y <= box.y + box.height
    )
  }

  function lineLength(start, end) {
    return Math.hypot(end.x - start.x, end.y - start.y)
  }

  function onCanvasClick(e) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    const point = getCanvasPoint(e)
    if (useRoi && !roi) {
      setError('Draw the entrance box first')
      return
    }
    if (useRoi && !pointInRoi(point, roi)) {
      setError('Place the line and hive-side point inside the entrance box')
      return
    }

    if (!lineStart) {
      setLineStart(point)
      setLineEnd(null)
      setHivePoint(null)
      setResult(null)
      setError('')
      return
    }

    if (!lineEnd) {
      if (lineLength(lineStart, point) < 20) {
        setError('Make the counting line a little longer')
        return
      }
      setLineEnd(point)
      setLineDraftEnd(null)
      setHivePoint(null)
      setResult(null)
      setError('')
      return
    }

    setHivePoint(point)
    setResult(null)
    setError('')
  }

  function onCanvasMouseDown(e) {
    if (!useRoi || roi) return
    const { x, y } = getCanvasPoint(e)
    dragRef.current = { startX: x, startY: y }
    setDraftRoi({ x, y, width: 0, height: 0 })
  }

  function onCanvasMouseMove(e) {
    const point = getCanvasPoint(e)
    if (dragRef.current) {
      const { startX, startY } = dragRef.current
      setDraftRoi({
        x: Math.min(startX, point.x),
        y: Math.min(startY, point.y),
        width: Math.abs(point.x - startX),
        height: Math.abs(point.y - startY)
      })
      return
    }

    if (lineStart && !lineEnd) {
      setLineDraftEnd(pointInRoi(point, useRoi ? roi : null) ? point : null)
    }
  }

  function onCanvasMouseUp(e) {
    if (!dragRef.current) return
    const { x, y } = getCanvasPoint(e)
    const { startX, startY } = dragRef.current
    dragRef.current = null
    setDraftRoi(null)
    const left = Math.min(startX, x)
    const top = Math.min(startY, y)
    const width = Math.abs(x - startX)
    const height = Math.abs(y - startY)

    if (width < 20 || height < 20) return

    setRoi({ x: left, y: top, width, height })
    suppressClickRef.current = true
    clearLineSetup()
    setResult(null)
    setError('')
  }

  function handleFile(f) {
    if (!f || !f.type.startsWith('video/')) {
      setError('Please upload a video file (MP4, MOV, AVI)')
      return
    }
    if (f.size > 1024 * 1024 * 1024) {
      setError('Video must be under 200MB')
      return
    }
    setVideoFile(f)
    const baseName = f.name.replace(/\.[^.]+$/, '')
    setDownloadName(`${baseName}_${backendMode}`)
    setError('')
  }

  async function loadFirstFrame() {
    if (!videoFile) return
    setUploading(true)
    setError('')
    setProgressLabel('Uploading video')
    setProgressPercent(4)
    setProgressMode('determinate')
    try {
      const form = new FormData()
      form.append('video', videoFile)
      const { data } = await api.post(countApiPath(backendMode, '/api/get-first-frame'), form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: event => updateUploadProgress(event, 'Uploading video', 'Finding the counting line')
      })
      setProgressLabel('Automatic setup ready')
      setProgressPercent(100)
      setProgressMode('determinate')
      setFrame(data.frame)
      setFrameW(data.width)
      setFrameH(data.height)
      setSuggestedSetup(data.suggested_setup || null)
      setTunedSetup(data.tuned_setup || null)
      const autoSetup = data.suggested_setup || data.tuned_setup
      if (!autoSetup) {
        throw new Error('Automatic setup could not be created for this video')
      }
      applySetup(autoSetup)
      setStep(1)
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to start automatic counting')
      setStep(0)
    } finally {
      setUploading(false)
      resetProgress()
    }
  }

  async function runCountingWithSetup(setup, options = {}) {
    const selectedUseRoi = options.selectedUseRoi ?? false
    const selectedRoi = options.selectedRoi ?? null
    if (
      setup?.line_x1 === undefined
      || setup?.line_x2 === undefined
      || setup?.hive_x === undefined
      || setup?.hive_y === undefined
    ) {
      throw new Error('Automatic setup is incomplete')
    }

    setStep(2)
    setError('')
    setProgressLabel('Uploading video')
    setProgressPercent(4)
    setProgressMode('determinate')

    const form = new FormData()
    form.append('video', videoFile)
    form.append('line_x1', setup.line_x1.toString())
    form.append('line_y1', setup.line_y1.toString())
    form.append('line_x2', setup.line_x2.toString())
    form.append('line_y2', setup.line_y2.toString())
    form.append('hive_x', setup.hive_x.toString())
    form.append('hive_y', setup.hive_y.toString())
    form.append('use_roi', selectedUseRoi ? 'true' : 'false')
    if (selectedUseRoi && selectedRoi) {
      form.append('roi_x', selectedRoi.x.toString())
      form.append('roi_y', selectedRoi.y.toString())
      form.append('roi_w', selectedRoi.width.toString())
      form.append('roi_h', selectedRoi.height.toString())
    }
    form.append('debug', 'false')
    form.append('trial_mode', trialMode)
    const { data } = await api.post(countApiPath(backendMode, '/api/count-video'), form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 1200000,
      onUploadProgress: event => updateUploadProgress(event, 'Uploading video', 'Tracking bee crossings')
    })
    setProgressLabel('Finalising results')
    setProgressPercent(100)
    setProgressMode('determinate')
    setResult(data)
    setStep(3)
  }

  async function runCounting() {
    if (useRoi && !roi) {
      setError('Please draw an entrance box first')
      return
    }
    if (!lineStart || !lineEnd) {
      setError('Please place both points of the counting line')
      return
    }
    if (!hivePoint) {
      setError('Please click once on the hive side of the line')
      return
    }

    setStep(2)
    setError('')
    setProgressLabel('Uploading video')
    setProgressPercent(4)
    setProgressMode('determinate')

    try {
      await runCountingWithSetup({
        line_x1: lineStart.x,
        line_y1: lineStart.y,
        line_x2: lineEnd.x,
        line_y2: lineEnd.y,
        hive_x: hivePoint.x,
        hive_y: hivePoint.y
      }, {
        selectedUseRoi: useRoi,
        selectedRoi: roi
      })
    } catch (err) {
      setError(err.response?.data?.error || 'Counting failed - try a shorter video')
      setStep(1)
    } finally {
      resetProgress()
    }
  }

  function downloadVideo() {
    if (!result?.video_b64) return
    const bytes = atob(result.video_b64)
    const arr = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
    const blob = new Blob([arr], { type: 'video/mp4' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safeName = (downloadName || 'bee_count_result')
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
    a.download = `${safeName || 'bee_count_result'}.mp4`
    a.click()
    URL.revokeObjectURL(url)
  }

  function reset() {
    resetCountSession()
  }

  return (
    <Layout>
      <BeeBackground />
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Video traffic trial</h1>
          <p className={s.sub}>Validate entrance crossings from recorded phone footage before running a live field session.</p>
        </div>
        <div className={s.sessionBadge}>
          <span>Session</span>
          <strong>{videoFile ? videoFile.name : 'No video selected'}</strong>
        </div>
      </div>

      <div className={s.stepper}>
        {STEPS.map((item, i) => (
          <div key={item.label} className={`${s.stepItem} ${i === wizardStep ? s.stepActive : ''} ${i < wizardStep ? s.stepDone : ''}`}>
            <div className={s.stepDot}>{i < wizardStep ? 'OK' : i + 1}</div>
            <div>
              <div className={s.stepLabel}>{item.label}</div>
              <div className={s.stepDetail}>{item.detail}</div>
            </div>
            {i < STEPS.length - 1 && <div className={s.stepLine} />}
          </div>
        ))}
      </div>

      <div className={`${s.content} fade-in`}>
        {step === 0 && (
          <div className={s.panel}>
            <div className={s.wizardPanelHeader}>
              <div>
                <div className={s.panelTitle}>Upload your phone video</div>
                <p className={s.panelSub}>Start with a stable recording of the hive entrance. The system will find the flight path, place the counting gate, and start processing automatically.</p>
              </div>
              <div className={s.stepCounter}>Step 1 of {STEPS.length}</div>
            </div>

            <div className={s.wizardSplit}>
              <aside className={s.guidePanel}>
                <div className={s.guideKicker}>Before upload</div>
                <div className={s.guideTitle}>Phone recording checklist</div>
                <div className={s.guideList}>
                  {PHONE_CAPTURE_GUIDE.map((item, index) => (
                    <div key={item.label} className={s.guideItem}>
                      <span className={s.guideNumber}>{index + 1}</span>
                      <div>
                        <div className={s.guideItemTitle}>{item.label}</div>
                        <div className={s.guideItemText}>{item.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </aside>

              <div className={s.wizardMain}>
                <div className={s.autoSetupCard}>
                  <div>
                    <div className={s.autoSetupKicker}>Traffic analysis trial</div>
                    <div className={s.autoSetupTitle}>{trialMode === 'hybrid' ? 'Hybrid validation run' : 'Motion validation run'}</div>
                    <div className={s.autoSetupText}>
                      {trialMode === 'hybrid'
                        ? 'Compare motion tracks with YOLO confirmations while keeping fast blur crossings in review.'
                        : 'Validate whether motion tracking catches fast bee traffic before using live phone tracking.'}
                    </div>
                  </div>
                  <div className={s.autoSetupMeta}>{trialMode === 'hybrid' ? 'Motion + YOLO' : 'Motion only'}</div>
                </div>

                <div className={s.trialModePicker}>
                  <button
                    type="button"
                    className={`${s.trialModeButton} ${trialMode === 'motion' ? s.trialModeButtonActive : ''}`}
                    onClick={() => setTrialMode('motion')}
                  >
                    <span>Motion only</span>
                    <strong>Fast baseline without YOLO confirmation.</strong>
                  </button>
                  <button
                    type="button"
                    className={`${s.trialModeButton} ${trialMode === 'hybrid' ? s.trialModeButtonActive : ''}`}
                    onClick={() => setTrialMode('hybrid')}
                  >
                    <span>Hybrid trial</span>
                    <strong>Motion count plus sampled YOLO verification.</strong>
                  </button>
                </div>

                <div
                  className={`${s.dropzone} ${dragging ? s.dragOver : ''}`}
                  onClick={() => inputRef.current.click()}
                  onDragOver={e => { e.preventDefault(); setDragging(true) }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]) }}
                >
                  {videoFile ? (
                    <>
                      <div className={s.dropIcon}>Video</div>
                      <div className={s.dropText}>{videoFile.name}</div>
                      <div className={s.dropSub}>{(videoFile.size / (1024 * 1024)).toFixed(1)} MB - click to change</div>
                    </>
                  ) : (
                    <>
                      <div className={s.dropIcon}>Video</div>
                      <div className={s.dropText}>Click or drag video here</div>
                      <div className={s.dropSub}>MP4, MOV, AVI - max 200MB</div>
                    </>
                  )}
                  <input
                    ref={inputRef}
                    type="file"
                    accept="video/*"
                    style={{ display: 'none' }}
                    onChange={e => handleFile(e.target.files[0])}
                  />
                </div>

                {error && <div className={s.error}>{error}</div>}
                {uploading && (
                  <ProgressBar
                    label={progressLabel || 'Uploading video'}
                    percent={progressPercent}
                    mode={progressMode}
                  />
                )}

                <div className={s.wizardFooter}>
                  <div className={s.footerHint}>
                    {videoFile ? 'Video ready. The next screen will preview the auto line and hive side.' : 'Choose a video before continuing.'}
                  </div>
                  <button className={s.btnPrimary} onClick={loadFirstFrame} disabled={!videoFile || uploading}>
                    {uploading ? 'Preparing preview...' : 'Preview automatic setup'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className={s.panel}>
            <div className={s.wizardPanelHeader}>
              <div>
                <div className={s.panelTitle}>Review the automatic counting path</div>
                <p className={s.panelSub}>
                  The green shaded area marks the hive side. The dashed line is where in/out crossings will be counted.
                </p>
              </div>
              <div className={s.stepCounter}>Step 2 of {STEPS.length}</div>
            </div>

            <div className={s.calibrationLayout}>
              <aside className={s.calibrationGuide}>
            <div className={s.setupModes}>
              <button
                type="button"
                className={`${s.modeCard} ${!useRoi ? s.modeCardActive : ''}`}
                onClick={() => clearAllSetup(false)}
              >
                <div className={s.modeTitle}>Quick mode</div>
                <div className={s.modeSub}>Full frame, line only. Best for fast setup and motion mode.</div>
              </button>
              <button
                type="button"
                className={`${s.modeCard} ${useRoi ? s.modeCardActive : ''}`}
                onClick={() => clearAllSetup(true)}
              >
                <div className={s.modeTitle}>Advanced mode</div>
                <div className={s.modeSub}>Add a small entrance ROI if the full-frame result is too noisy.</div>
              </button>
            </div>

            <div className={s.setupSummary}>
              <div className={s.currentAction}>
                <div className={s.currentActionLabel}>Automatic setup</div>
                <div className={s.currentActionValue}>{lineStart && lineEnd && hivePoint ? 'Ready to count' : currentAction}</div>
                <div className={s.currentActionMeta}>{setupDoneCount} of {checklist.length} setup tasks complete</div>
              </div>
              <div className={s.setupChecklist}>
                {checklist.map((item, index) => (
                  <div key={item.key} className={`${s.checkItem} ${item.done ? s.checkItemDone : ''}`}>
                    <span className={s.checkDot}>{item.done ? 'OK' : '•'}</span>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className={s.setupTips}>
              <div className={s.tipCard}>
                <div className={s.tipTitle}>{setupStatus.title}</div>
                <div className={s.tipBody}>{setupStatus.detail}</div>
                <div className={s.tipFoot}>Tip: {setupStatus.tip}</div>
              </div>
              <div className={s.tipCardAlt}>
                <div className={s.tipTitle}>What to check</div>
                <div className={s.tipList}>1. Green side should cover the hive entrance or hive wall.</div>
                <div className={s.tipList}>2. Dashed line should sit just outside the hover zone.</div>
                <div className={s.tipList}>3. Bees entering should cross from open air into the green side.</div>
                <div className={s.tipList}>4. If the preview looks wrong, redraw the line before counting.</div>
              </div>
            </div>

              </aside>

              <div className={s.calibrationStage}>
            <div className={s.canvasWrap}>
              <canvas
                ref={canvasRef}
                width={frameW}
                height={frameH}
                className={s.canvas}
                onMouseDown={onCanvasMouseDown}
                onMouseMove={onCanvasMouseMove}
                onMouseUp={onCanvasMouseUp}
                onClick={onCanvasClick}
              />
              <div className={s.canvasHint}>{getSetupHint()}</div>
            </div>

            <div className={s.lineControls}>
              <div className={s.lineInfo}>
                {!useRoi ? 'Using full video frame' : roi ? 'Entrance area ready' : 'Entrance area not set'}
              </div>
              <div className={s.lineInfo}>
                {lineStart && lineEnd ? 'Counting line ready' : 'Counting line not ready'}
              </div>
              <div className={s.lineInfo}>
                {hivePoint ? 'Hive side preview ready' : 'Hive side not marked'}
              </div>
              <div className={s.lineInfo}>
                {lineStart && lineEnd && hivePoint ? 'Auto setup ready' : 'Review setup before counting'}
              </div>
              {useRoi && roi && (
                <button className={s.btnReset} type="button" onClick={() => { setRoi(null); setDraftRoi(null); clearLineSetup() }}>
                  Redraw ROI
                </button>
              )}
              {lineStart && (
                <button className={s.btnReset} type="button" onClick={clearLineSetup}>
                  Redraw line
                </button>
              )}
              {hivePoint && (
                <button className={s.btnReset} type="button" onClick={() => setHivePoint(null)}>
                  Re-mark hive side
                </button>
              )}
              {backendMode === 'motion' && suggestedSetup && (
                <button className={s.btnReset} type="button" onClick={() => applySetup(suggestedSetup, 'Default suggested setup')}>
                  Restore default setup
                </button>
              )}
              {backendMode === 'motion' && tunedSetup && (
                <button className={s.btnReset} type="button" onClick={() => applySetup(tunedSetup, tunedSetup.label || 'Tuned preset')}>
                  Apply tuned preset
                </button>
              )}
            </div>

            {error && <div className={s.error}>{error}</div>}

            <div className={s.btnRow}>
              <button className={s.btnSecondary} onClick={() => { setStep(0); setFrame(null); clearAllSetup(true) }}>
                Back
              </button>
              <button className={s.btnSecondary} onClick={() => clearAllSetup(useRoi)}>
                Reset setup
              </button>
              <button className={s.btnPrimary} onClick={runCounting} disabled={(useRoi && !roi) || !lineStart || !lineEnd || !hivePoint}>
                Start counting
              </button>
            </div>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className={`${s.panel} ${s.processingPanel}`}>
            <div className={s.wizardPanelHeader}>
              <div>
                <div className={s.panelTitle}>Processing video</div>
                <p className={s.panelSub}>The system is detecting motion, linking tracks, and checking line crossings.</p>
              </div>
              <div className={s.stepCounter}>Step 3 of {STEPS.length}</div>
            </div>
            <div className={s.processingWrap}>
              <div className={s.processingVisual} aria-hidden="true">
                <div className={s.scanRing}>
                  <span className={s.scanBee} />
                  <span className={s.scanBeeAlt} />
                </div>
                <div className={s.scanCore}>
                  <span />
                  <span />
                  <span />
                </div>
              </div>

              <div className={s.processingCopy}>
                <div className={s.processingKicker}>Counting in progress</div>
                <div className={s.processingTitle}>Scanning every frame</div>
                <p className={s.processingSub}>
                  {progressLabel || 'Tracking bee crossings in the uploaded video.'}
                </p>
                <ProgressBar
                  label={progressLabel || 'Tracking bee crossings'}
                  percent={progressPercent}
                  mode={progressMode}
                />
              </div>

              <div className={s.processingPhases}>
                {PROCESSING_PHASES.map((phase, index) => (
                  <div
                    key={phase}
                    className={s.processingPhase}
                    style={{ '--delay': `${index * 0.28}s` }}
                  >
                    <span className={s.phaseDot} />
                    <span>{phase}</span>
                  </div>
                ))}
              </div>

              <div className={s.beeFact}>
                <div className={s.beeFactLabel}>{BEE_PROCESSING_FACTS[processingFactIndex].label}</div>
                <div className={s.beeFactText}>{BEE_PROCESSING_FACTS[processingFactIndex].text}</div>
              </div>

              <div className={s.processingNote}>You can continue using other panels while the annotated video is being prepared.</div>
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div className={s.panel}>
            <div className={s.wizardPanelHeader}>
              <div>
                <div className={s.panelTitle}>Counting complete</div>
                <p className={s.panelSub}>Review the traffic summary, download the annotated video, or start another count session.</p>
              </div>
              <div className={s.stepCounter}>Step 4 of {STEPS.length}</div>
            </div>

            <div className={s.resultGrid}>
              <div className={s.resultCard} style={{ '--rc': 'var(--green)' }}>
                <div className={s.resultLabel}>Total bees IN</div>
                <div className={s.resultVal}>{result.total_in}</div>
              </div>
              <div className={s.resultCard} style={{ '--rc': 'var(--red)' }}>
                <div className={s.resultLabel}>Total bees OUT</div>
                <div className={s.resultVal}>{result.total_out}</div>
              </div>
              <div className={s.resultCard} style={{ '--rc': 'var(--amber)' }}>
                <div className={s.resultLabel}>Net movement</div>
                <div className={s.resultVal}>
                  {result.total_in - result.total_out >= 0 ? '+' : ''}
                  {result.total_in - result.total_out}
                </div>
              </div>
              <div className={s.resultCard} style={{ '--rc': 'var(--muted)' }}>
                <div className={s.resultLabel}>Frames processed</div>
                <div className={s.resultVal}>{result.total_frames}</div>
              </div>
            </div>

            {result.trial_report && (
              <div className={s.trialReport}>
                <div className={s.trialHeader}>
                  <div>
                    <div className={s.trialKicker}>Traffic analysis trial</div>
                    <div className={s.panelTitle}>Motion tracking validation</div>
                  </div>
                  <div className={s.trialVerdict}>{result.trial_report.verdict}</div>
                </div>

                <div className={s.trialMetrics}>
                  <div>
                    <span>Analysed frames</span>
                    <strong>{result.trial_report.analysed_frames}</strong>
                  </div>
                  <div>
                    <span>Detection coverage</span>
                    <strong>{result.trial_report.detection_rate}%</strong>
                  </div>
                  <div>
                    <span>Avg detections/frame</span>
                    <strong>{result.trial_report.avg_detections_per_frame}</strong>
                  </div>
                  <div>
                    <span>Max detections/frame</span>
                    <strong>{result.trial_report.max_detections_in_frame}</strong>
                  </div>
                  <div>
                    <span>Avg motion pixels</span>
                    <strong>{result.trial_report.avg_motion_pixels}</strong>
                  </div>
                  <div>
                    <span>Counted crossings</span>
                    <strong>{result.trial_report.counted_events}</strong>
                  </div>
                </div>

                {result.trial_report.hybrid?.enabled && (
                  <div className={s.hybridCompare}>
                    <div className={s.hybridColumn}>
                      <div className={s.hybridLabel}>Motion evidence</div>
                      <div className={s.hybridValue}>{result.trial_report.counted_events}</div>
                      <p>Crossings counted from motion tracks, including fast blur trails.</p>
                    </div>
                    <div className={s.hybridColumn}>
                      <div className={s.hybridLabel}>YOLO confirmation</div>
                      <div className={s.hybridValue}>{result.trial_report.hybrid.total_detections}</div>
                      <p>YOLO detections found on sampled frames using {result.trial_report.hybrid.model}.</p>
                    </div>
                    <div className={s.hybridColumn}>
                      <div className={s.hybridLabel}>Motion matched by YOLO</div>
                      <div className={s.hybridValue}>{result.trial_report.hybrid.motion_match_rate}%</div>
                      <p>{result.trial_report.hybrid.interpretation}</p>
                    </div>
                    <div className={s.hybridColumn}>
                      <div className={s.hybridLabel}>Event verification</div>
                      <div className={s.hybridValue}>
                        {result.trial_report.hybrid.yolo_verified_events}/{result.trial_report.counted_events}
                      </div>
                      <p>Counted events near recent YOLO confirmations. Unverified events may still be fast bees.</p>
                    </div>
                    {!result.trial_report.hybrid.available && (
                      <div className={s.error}>Hybrid YOLO check failed: {result.trial_report.hybrid.error}</div>
                    )}
                  </div>
                )}

                <div className={s.trialReview}>
                  {result.trial_report.review_steps?.map((item, index) => (
                    <div key={item} className={s.trialReviewItem}>
                      <span>{index + 1}</span>
                      <p>{item}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={s.btnRow} style={{ marginTop: 20 }}>
              <button className={s.btnSecondary} onClick={reset}>Count another video</button>
              {result.video_b64 && (
                <>
                  <div className={s.downloadRename}>
                    <label htmlFor="downloadName" className={s.downloadLabel}>File name</label>
                    <div className={s.downloadInputWrap}>
                      <input
                        id="downloadName"
                        className={s.downloadInput}
                        type="text"
                        value={downloadName}
                        onChange={e => setDownloadName(e.target.value)}
                        placeholder="bee_count_result"
                      />
                      <span className={s.downloadExt}>.mp4</span>
                    </div>
                  </div>
                  <button className={s.btnPrimary} onClick={downloadVideo}>
                    Download annotated video
                  </button>
                </>
              )}
            </div>

          </div>
        )}

        {error && step !== 0 && step !== 1 && <div className={s.error}>{error}</div>}
      </div>
    </Layout>
  )
}
