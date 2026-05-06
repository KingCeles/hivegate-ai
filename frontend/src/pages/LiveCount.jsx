import { useEffect, useRef, useState } from 'react'
import Layout from '../components/Layout'
import BeeBackground from '../components/BeeBackground'
import api from '../api/client'
import s from './LiveCount.module.css'

const CAMERA_CONSTRAINTS = {
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 }
  },
  audio: false
}

const AUTO_SETUP_SAMPLE_COUNT = 42
const AUTO_SETUP_SAMPLE_INTERVAL_MS = 160
const AUTO_SETUP_COLUMNS = 40
const AUTO_SETUP_ROWS = 24
const LIVE_DETECTION_INTERVAL_MS = 240
const LIVE_SESSION_PUBLISH_INTERVAL_MS = 1800
const LIVE_MAX_CONSECUTIVE_ERRORS = 6
const TRACK_STALE_FRAMES = 8
const TRACK_COOLDOWN_FRAMES = 12
const LIVE_CROSSING_RATIO = 0.85
const MOTION_API_BASE = import.meta.env.VITE_COUNT_API_URL || '/motion-api'

function drawGuide(canvas, video) {
  const width = video.videoWidth || 1280
  const height = video.videoHeight || 720
  if (!width || !height) return null

  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, width, height)

  const lineX = Math.round(width * 0.5)
  const edgePad = Math.max(2, Math.round(height * 0.01))
  const lineTop = edgePad
  const lineBottom = height - edgePad
  const hiveX = Math.round(width * 0.38)
  const hiveY = Math.round(height * 0.5)

  ctx.fillStyle = 'rgba(82, 196, 138, 0.16)'
  ctx.fillRect(0, 0, lineX, height)

  ctx.beginPath()
  ctx.moveTo(lineX, lineTop)
  ctx.lineTo(lineX, lineBottom)
  ctx.strokeStyle = '#00ffcc'
  ctx.lineWidth = Math.max(4, Math.round(width / 260))
  ctx.setLineDash([18, 10])
  ctx.stroke()
  ctx.setLineDash([])

  ctx.fillStyle = '#00ffcc'
  ctx.beginPath()
  ctx.arc(lineX, lineTop, 8, 0, Math.PI * 2)
  ctx.arc(lineX, lineBottom, 8, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#52c48a'
  ctx.strokeStyle = '#07130d'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(hiveX, hiveY, 12, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  ctx.font = `700 ${Math.max(18, Math.round(width / 52))}px Sora, sans-serif`
  ctx.fillStyle = '#00ffcc'
  ctx.fillText('Counting line', lineX + 18, Math.max(30, lineTop - 14))
  ctx.fillStyle = '#52c48a'
  ctx.fillText('Hive side', hiveX + 18, hiveY - 18)

  return {
    line_x1: lineX,
    line_y1: lineTop,
    line_x2: lineX,
    line_y2: lineBottom,
    hive_x: hiveX,
    hive_y: hiveY
  }
}

function drawSetup(canvas, video, setup, label = 'Motion line') {
  const width = video.videoWidth || 1280
  const height = video.videoHeight || 720
  if (!width || !height || !setup) return null

  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, width, height)

  const lineX = setup.line_x1
  const lineTop = setup.line_y1
  const lineBottom = setup.line_y2
  const hiveX = setup.hive_x
  const hiveY = setup.hive_y
  const hiveIsLeft = hiveX < lineX

  ctx.fillStyle = 'rgba(82, 196, 138, 0.16)'
  if (hiveIsLeft) {
    ctx.fillRect(0, 0, lineX, height)
  } else {
    ctx.fillRect(lineX, 0, width - lineX, height)
  }

  ctx.beginPath()
  ctx.moveTo(lineX, lineTop)
  ctx.lineTo(lineX, lineBottom)
  ctx.strokeStyle = '#00ffcc'
  ctx.lineWidth = Math.max(4, Math.round(width / 260))
  ctx.setLineDash([18, 10])
  ctx.stroke()
  ctx.setLineDash([])

  ctx.fillStyle = '#00ffcc'
  ctx.beginPath()
  ctx.arc(lineX, lineTop, 8, 0, Math.PI * 2)
  ctx.arc(lineX, lineBottom, 8, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#52c48a'
  ctx.strokeStyle = '#07130d'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(hiveX, hiveY, 12, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  ctx.font = `700 ${Math.max(18, Math.round(width / 52))}px Sora, sans-serif`
  ctx.fillStyle = '#00ffcc'
  ctx.fillText(label, lineX + 18, Math.max(30, lineTop - 14))
  ctx.fillStyle = '#52c48a'
  ctx.fillText('Hive side', hiveX + 18, hiveY - 18)

  return setup
}

function drawDetections(canvas, video, setup, detections, yoloDetections = []) {
  drawSetup(canvas, video, setup, 'Backend motion line')

  const ctx = canvas.getContext('2d')
  ctx.save()
  yoloDetections.forEach((detection, index) => {
    const [x1, y1, x2, y2] = detection.bbox
    ctx.strokeStyle = '#b455ff'
    ctx.lineWidth = 3
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)'
    ctx.fillRect(x1, Math.max(0, y1 - 30), 104, 26)
    ctx.fillStyle = '#d8a7ff'
    ctx.font = '700 16px Sora, sans-serif'
    ctx.fillText(`Y${index + 1} ${detection.confidence}`, x1 + 8, Math.max(18, y1 - 10))
  })

  detections.forEach((detection, index) => {
    const [x1, y1, x2, y2] = detection.bbox
    const width = x2 - x1
    const height = y2 - y1
    ctx.strokeStyle = detection.yolo_verified ? '#b455ff' : detection.source === 'dark-motion' ? '#ffb020' : '#00ffcc'
    ctx.lineWidth = 3
    ctx.strokeRect(x1, y1, width, height)

    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)'
    ctx.fillRect(x1, Math.max(0, y1 - 30), 118, 26)
    ctx.fillStyle = ctx.strokeStyle
    ctx.font = '700 16px Sora, sans-serif'
    ctx.fillText(`${detection.yolo_verified ? 'V' : 'D'}${index + 1} ${detection.zone}`, x1 + 8, Math.max(18, y1 - 10))
  })
  ctx.restore()
}

function drawLiveCounters(canvas, counts) {
  const ctx = canvas.getContext('2d')
  const scale = Math.max(1, canvas.width / 960)
  const panelW = Math.round(245 * scale)
  const panelH = Math.round(104 * scale)
  const x = Math.round(18 * scale)
  const y = Math.round(18 * scale)

  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.68)'
  ctx.fillRect(x, y, panelW, panelH)
  ctx.font = `800 ${Math.round(16 * scale)}px Sora, sans-serif`
  ctx.fillStyle = '#fff'
  ctx.fillText('Live count', x + Math.round(14 * scale), y + Math.round(25 * scale))
  ctx.font = `900 ${Math.round(28 * scale)}px Sora, sans-serif`
  ctx.fillStyle = '#52c48a'
  ctx.fillText(`IN ${counts.in}`, x + Math.round(14 * scale), y + Math.round(65 * scale))
  ctx.fillStyle = '#ff6b6b'
  ctx.fillText(`OUT ${counts.out}`, x + Math.round(120 * scale), y + Math.round(65 * scale))
  ctx.font = `700 ${Math.round(12 * scale)}px Sora, sans-serif`
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)'
  ctx.fillText(`Net ${counts.in - counts.out >= 0 ? '+' : ''}${counts.in - counts.out}`, x + Math.round(14 * scale), y + Math.round(90 * scale))
  ctx.restore()
}

function captureFrameBlob(video, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) {
      reject(new Error('Camera frame is not ready yet.'))
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0, width, height)
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('Could not encode camera frame.'))
        return
      }
      resolve(blob)
    }, 'image/jpeg', quality)
  })
}

async function postMotionFrame(form) {
  const endpoint = `${MOTION_API_BASE}/api/live-frame`
  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      body: form,
      cache: 'no-store'
    })
  } catch (err) {
    throw new Error(`Motion backend network error at ${endpoint}. Open the page from the current laptop URL and make sure the dev server is still running.`)
  }

  let data = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    throw new Error(data?.error || `Motion backend returned HTTP ${response.status}`)
  }

  return data
}

async function checkMotionBackendReachable() {
  try {
    const response = await fetch(`${MOTION_API_BASE}/api/health`, { cache: 'no-store' })
    return response.ok
  } catch {
    return false
  }
}

function createLiveNodeId() {
  const randomPart = window.crypto?.randomUUID
    ? window.crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  return `phone-${randomPart}`
}

function getStoredLiveNodeId() {
  const key = 'bee_live_node_id'
  const existing = window.localStorage.getItem(key)
  if (existing) return existing
  const next = createLiveNodeId()
  window.localStorage.setItem(key, next)
  return next
}

function getStoredHiveLabel() {
  return window.localStorage.getItem('bee_live_hive_label') || 'Hive 1'
}

function suggestSetupFromMotion(luminanceFrames, width, height, columns = AUTO_SETUP_COLUMNS, rows = AUTO_SETUP_ROWS) {
  if (luminanceFrames.length < 2 || !width || !height) return null

  const scores = new Array(columns).fill(0)
  const darkness = new Array(columns).fill(0)
  const firstFrame = luminanceFrames[0]
  const lastFrame = luminanceFrames[luminanceFrames.length - 1]

  for (let i = 0; i < lastFrame.length; i += 1) {
    const column = i % columns
    darkness[column] += 255 - lastFrame[i]
  }

  for (let frameIndex = 1; frameIndex < luminanceFrames.length; frameIndex += 1) {
    const prev = luminanceFrames[frameIndex - 1]
    const curr = luminanceFrames[frameIndex]
    for (let i = 0; i < curr.length; i += 1) {
      const diff = Math.abs(curr[i] - prev[i])
      if (diff < 18) continue
      scores[i % columns] += diff
    }
  }

  let bestColumn = Math.floor(columns / 2)
  let bestScore = 0
  scores.forEach((score, column) => {
    if (score > bestScore) {
      bestScore = score
      bestColumn = column
    }
  })

  const lineX = Math.round(((bestColumn + 0.5) / columns) * width)
  const clampedLineX = Math.max(Math.round(width * 0.12), Math.min(Math.round(width * 0.88), lineX))
  const lineColumn = Math.max(1, Math.min(columns - 2, Math.round((clampedLineX / width) * columns)))
  const marginColumns = Math.max(2, Math.round(columns * 0.08))
  const leftMotion = scores.slice(0, Math.max(1, lineColumn - marginColumns)).reduce((sum, value) => sum + value, 0)
  const rightMotion = scores.slice(Math.min(columns, lineColumn + marginColumns)).reduce((sum, value) => sum + value, 0)
  const leftDarkness = darkness.slice(0, Math.max(1, lineColumn)).reduce((sum, value) => sum + value, 0)
  const rightDarkness = darkness.slice(Math.min(columns, lineColumn)).reduce((sum, value) => sum + value, 0)
  const leftEdgeDarkness = darkness.slice(0, Math.max(1, Math.round(columns * 0.22))).reduce((sum, value) => sum + value, 0)
  const rightEdgeDarkness = darkness.slice(Math.max(0, columns - Math.round(columns * 0.22))).reduce((sum, value) => sum + value, 0)
  const hiveOnLeft = (leftDarkness + leftEdgeDarkness + (leftMotion * 0.25)) >= (rightDarkness + rightEdgeDarkness + (rightMotion * 0.25))
  const hiveX = hiveOnLeft
    ? Math.max(24, clampedLineX - Math.round(width * 0.16))
    : Math.min(width - 24, clampedLineX + Math.round(width * 0.16))

  return {
    line_x1: clampedLineX,
    line_y1: Math.max(2, Math.round(height * 0.01)),
    line_x2: clampedLineX,
    line_y2: height - Math.max(2, Math.round(height * 0.01)),
    hive_x: hiveX,
    hive_y: Math.round(height * 0.5),
    score: Math.round(bestScore),
    hive_side_guess: hiveOnLeft ? 'left' : 'right',
    hive_side_confidence: Math.round(Math.abs((leftDarkness + leftEdgeDarkness) - (rightDarkness + rightEdgeDarkness)) / Math.max(1, rows * 255))
  }
}

export default function LiveCount() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const shellRef = useRef(null)
  const streamRef = useRef(null)
  const samplingRef = useRef(false)
  const liveDetectionRef = useRef(false)
  const tracksRef = useRef(new Map())
  const nextTrackIdRef = useRef(1)
  const liveFrameIndexRef = useRef(0)
  const liveBaselineBlobRef = useRef(null)
  const liveCountsRef = useRef({ in: 0, out: 0 })
  const lastPublishAtRef = useRef(0)
  const lastPublishedCountsRef = useRef({ in: -1, out: -1 })
  const lastLiveToggleAtRef = useRef(0)
  const [status, setStatus] = useState('idle')
  const [setupStatus, setSetupStatus] = useState('not_started')
  const [setupProgress, setSetupProgress] = useState(0)
  const [backendStatus, setBackendStatus] = useState('not_tested')
  const [liveDetection, setLiveDetection] = useState(false)
  const [liveCounts, setLiveCounts] = useState({ in: 0, out: 0 })
  const [liveEvents, setLiveEvents] = useState([])
  const [livePublishStatus, setLivePublishStatus] = useState('not_started')
  const [liveMode, setLiveMode] = useState('motion')
  const [sensitivity, setSensitivity] = useState('normal')
  const [nodeId] = useState(getStoredLiveNodeId)
  const [hiveLabel, setHiveLabel] = useState(getStoredHiveLabel)
  const [immersive, setImmersive] = useState(false)
  const [error, setError] = useState('')
  const [setup, setSetup] = useState(null)

  function stopLiveDetection(nextStatus = status) {
    liveDetectionRef.current = false
    liveBaselineBlobRef.current = null
    setLiveDetection(false)
    setBackendStatus(nextStatus === 'live' ? 'ready_to_test' : 'not_tested')
  }

  function toggleLiveDetection() {
    const now = Date.now()
    if (now - lastLiveToggleAtRef.current < 900) return
    lastLiveToggleAtRef.current = now

    if (liveDetectionRef.current || liveDetection) {
      stopLiveDetection('live')
      return
    }
    startLiveDetection()
  }

  function resetLiveCounters() {
    tracksRef.current = new Map()
    nextTrackIdRef.current = 1
    liveFrameIndexRef.current = 0
    if (!liveDetectionRef.current) {
      liveBaselineBlobRef.current = null
    }
    liveCountsRef.current = { in: 0, out: 0 }
    lastPublishedCountsRef.current = { in: -1, out: -1 }
    setLiveCounts({ in: 0, out: 0 })
    setLiveEvents([])
    if (streamRef.current && canvasRef.current && videoRef.current && setup) {
      drawSetup(canvasRef.current, videoRef.current, setup, 'Auto motion line')
      drawLiveCounters(canvasRef.current, { in: 0, out: 0 })
    }
  }

  function signedDistanceToLine(point, currentSetup) {
    const dx = currentSetup.line_x2 - currentSetup.line_x1
    const dy = currentSetup.line_y2 - currentSetup.line_y1
    const length = Math.hypot(dx, dy) || 1
    return (((point.x - currentSetup.line_x1) * dy) - ((point.y - currentSetup.line_y1) * dx)) / length
  }

  function zoneFromDistance(distance, margin) {
    if (distance < -margin) return 'left'
    if (distance > margin) return 'right'
    return 'center'
  }

  function countLabelForSide(side, currentSetup) {
    const hiveDistance = signedDistanceToLine({ x: currentSetup.hive_x, y: currentSetup.hive_y }, currentSetup)
    const sideSign = side === 'right' ? 1 : -1
    return sideSign * hiveDistance > 0 ? 'IN' : 'OUT'
  }

  function motionRelativeToLine(fromPoint, toPoint, currentSetup) {
    const lineDx = currentSetup.line_x2 - currentSetup.line_x1
    const lineDy = currentSetup.line_y2 - currentSetup.line_y1
    const length = Math.hypot(lineDx, lineDy) || 1
    const lineUx = lineDx / length
    const lineUy = lineDy / length
    const normalX = lineDy / length
    const normalY = -lineDx / length
    const dx = toPoint.x - fromPoint.x
    const dy = toPoint.y - fromPoint.y
    return {
      perpendicular: Math.abs(dx * normalX + dy * normalY),
      parallel: Math.abs(dx * lineUx + dy * lineUy)
    }
  }

  function updateLiveTracks(detections) {
    if (!setup || !videoRef.current) return liveCountsRef.current

    const frameIndex = liveFrameIndexRef.current + 1
    liveFrameIndexRef.current = frameIndex
    const tracks = tracksRef.current
    const margin = Math.max(6, Math.round((videoRef.current.videoWidth || 960) * 0.006))
    const maxMatchDistance = Math.max(90, Math.round((videoRef.current.videoWidth || 960) * 0.16))
    const assignedTracks = new Set()
    const events = []

    detections.forEach(detection => {
      const [x1, y1, x2, y2] = detection.bbox
      const center = {
        x: detection.center?.[0] ?? Math.round((x1 + x2) / 2),
        y: detection.center?.[1] ?? Math.round((y1 + y2) / 2)
      }

      let bestTrackId = null
      let bestDistance = Infinity
      tracks.forEach((track, trackId) => {
        if (assignedTracks.has(trackId)) return
        const age = frameIndex - track.lastSeen
        if (age > TRACK_STALE_FRAMES) return
        const distance = Math.hypot(center.x - track.center.x, center.y - track.center.y)
        if (distance < bestDistance && distance <= maxMatchDistance) {
          bestDistance = distance
          bestTrackId = trackId
        }
      })

      if (bestTrackId === null) {
        bestTrackId = nextTrackIdRef.current
        nextTrackIdRef.current += 1
        tracks.set(bestTrackId, {
          center,
          lastSeen: frameIndex,
          lastZone: 'center',
          approachZone: null,
          lastCounted: -TRACK_COOLDOWN_FRAMES,
          armed: true,
          perpendicularMotion: 0,
          parallelMotion: 0,
          lastPerpendicularStep: 0,
          lastParallelStep: 0,
          age: 0
        })
      }

      assignedTracks.add(bestTrackId)
      const track = tracks.get(bestTrackId)
      const distance = signedDistanceToLine(center, setup)
      const currentZone = zoneFromDistance(distance, margin)
      const previousZone = track.lastZone
      const previousDistance = track.lastDistance
      const rearmDistance = Math.max(margin * 3, Math.round((videoRef.current.videoWidth || 960) * 0.018))
      const minCrossingMotion = Math.max(margin * 2, Math.round((videoRef.current.videoWidth || 960) * 0.014))
      const motion = motionRelativeToLine(track.center, center, setup)
      track.lastPerpendicularStep = motion.perpendicular
      track.lastParallelStep = motion.parallel
      track.perpendicularMotion = (track.perpendicularMotion || 0) + motion.perpendicular
      track.parallelMotion = (track.parallelMotion || 0) + motion.parallel
      const crossingMotionOk = (
        track.armed !== false
        && track.perpendicularMotion >= minCrossingMotion
        && track.perpendicularMotion >= track.parallelMotion * LIVE_CROSSING_RATIO
        && (
          track.lastPerpendicularStep >= Math.max(margin, track.lastParallelStep * 0.6)
          || track.perpendicularMotion >= minCrossingMotion * 1.4
        )
      )
      track.age += 1

      const jumpedAcrossLine = (
        previousDistance !== undefined
        && Math.abs(distance - previousDistance) >= margin * 1.5
        && Math.sign(distance) !== Math.sign(previousDistance)
        && Math.sign(distance) !== 0
        && Math.sign(previousDistance) !== 0
      )
      if (
        jumpedAcrossLine
        && crossingMotionOk
        && frameIndex - track.lastCounted > TRACK_COOLDOWN_FRAMES
      ) {
        const toSide = distance > 0 ? 'right' : 'left'
        const fromSide = previousDistance > 0 ? 'right' : 'left'
        const label = countLabelForSide(toSide, setup)
        const nextCounts = {
          in: liveCountsRef.current.in + (label === 'IN' ? 1 : 0),
          out: liveCountsRef.current.out + (label === 'OUT' ? 1 : 0)
        }
        liveCountsRef.current = nextCounts
        setLiveCounts(nextCounts)
        const event = {
          frame: frameIndex,
          trackId: bestTrackId,
          label,
          from: fromSide,
          to: toSide,
          verified: detection.yolo_verified,
          reason: 'jump'
        }
        events.push(event)
        setLiveEvents(prev => [event, ...prev].slice(0, 6))
        track.lastCounted = frameIndex
        track.armed = false
        track.approachZone = null
        track.perpendicularMotion = 0
        track.parallelMotion = 0
      } else if (currentZone === 'center') {
        if (previousZone === 'left' || previousZone === 'right') {
          track.approachZone = previousZone
        }
      } else {
        const approachZone = track.approachZone || (previousZone !== currentZone && previousZone !== 'center' ? previousZone : null)
        if (
          approachZone
          && approachZone !== currentZone
          && crossingMotionOk
          && frameIndex - track.lastCounted > TRACK_COOLDOWN_FRAMES
        ) {
          const label = countLabelForSide(currentZone, setup)
          const nextCounts = {
            in: liveCountsRef.current.in + (label === 'IN' ? 1 : 0),
            out: liveCountsRef.current.out + (label === 'OUT' ? 1 : 0)
          }
          liveCountsRef.current = nextCounts
          setLiveCounts(nextCounts)
          const event = {
            frame: frameIndex,
            trackId: bestTrackId,
            label,
            from: approachZone,
            to: currentZone,
            verified: detection.yolo_verified,
            reason: 'zone'
          }
          events.push(event)
          setLiveEvents(prev => [event, ...prev].slice(0, 6))
          track.lastCounted = frameIndex
          track.armed = false
          track.approachZone = null
          track.perpendicularMotion = 0
          track.parallelMotion = 0
        } else if (approachZone === currentZone) {
          track.approachZone = null
        }
      }

      if (
        track.armed === false
        && currentZone !== 'center'
        && Math.abs(distance) >= rearmDistance
        && frameIndex - track.lastCounted > TRACK_COOLDOWN_FRAMES
      ) {
        track.armed = true
        track.approachZone = currentZone
        track.perpendicularMotion = 0
        track.parallelMotion = 0
        track.lastPerpendicularStep = 0
        track.lastParallelStep = 0
      }

      track.center = center
      track.lastZone = currentZone
      track.lastDistance = distance
      track.lastSeen = frameIndex
    })

    tracks.forEach((track, trackId) => {
      if (frameIndex - track.lastSeen > TRACK_STALE_FRAMES) {
        tracks.delete(trackId)
      }
    })

    return liveCountsRef.current
  }

  function stopCamera() {
    stopLiveDetection('idle')
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d')
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    }
    setSetup(null)
    setStatus('idle')
    setSetupStatus('not_started')
    setSetupProgress(0)
    setBackendStatus('not_tested')
    resetLiveCounters()
  }

  async function startCamera() {
    setError('')
    setStatus('starting')

    if (!window.isSecureContext) {
      setError('Phone browsers require HTTPS for camera access. Use a working HTTPS tunnel, or for Android Chrome testing only, enable chrome://flags/#unsafely-treat-insecure-origin-as-secure and add this app URL.')
      setStatus('idle')
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser does not support camera access.')
      setStatus('idle')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      setStatus('live')
      setSetup(null)
      setSetupStatus('waiting')
      setSetupProgress(0)
      setBackendStatus('not_tested')
      resetLiveCounters()
      await publishNodePresence('camera')
    } catch (err) {
      setError(err.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access and try again.'
        : err.message || 'Could not start camera.')
      setStatus('idle')
    }
  }

  function refreshGuide() {
    if (!videoRef.current || !canvasRef.current || status !== 'live') return
    stopLiveDetection('live')
    setSetup(drawGuide(canvasRef.current, videoRef.current))
    setSetupStatus('manual_guide')
  }

  async function runAutoSetup() {
    if (!videoRef.current || !canvasRef.current || status !== 'live' || samplingRef.current) return

    stopLiveDetection('live')
    setError('')
    setSetupStatus('sampling')
    setSetupProgress(0)
    setSetup(null)
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d')
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    }
    samplingRef.current = true

    const video = videoRef.current
    const width = video.videoWidth
    const height = video.videoHeight
    const sampleCanvas = document.createElement('canvas')
    const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true })
    sampleCanvas.width = AUTO_SETUP_COLUMNS
    sampleCanvas.height = AUTO_SETUP_ROWS
    const luminanceFrames = []

    try {
      for (let i = 0; i < AUTO_SETUP_SAMPLE_COUNT; i += 1) {
        sampleCtx.drawImage(video, 0, 0, AUTO_SETUP_COLUMNS, AUTO_SETUP_ROWS)
        const data = sampleCtx.getImageData(0, 0, AUTO_SETUP_COLUMNS, AUTO_SETUP_ROWS).data
        const frame = new Uint8Array(AUTO_SETUP_COLUMNS * AUTO_SETUP_ROWS)
        for (let sourceIndex = 0, targetIndex = 0; sourceIndex < data.length; sourceIndex += 4, targetIndex += 1) {
          frame[targetIndex] = Math.round(
            (data[sourceIndex] * 0.299)
            + (data[sourceIndex + 1] * 0.587)
            + (data[sourceIndex + 2] * 0.114)
          )
        }
        luminanceFrames.push(frame)
        setSetupProgress(Math.round(((i + 1) / AUTO_SETUP_SAMPLE_COUNT) * 100))
        await new Promise(resolve => window.setTimeout(resolve, AUTO_SETUP_SAMPLE_INTERVAL_MS))
      }

      const nextSetup = suggestSetupFromMotion(luminanceFrames, width, height)
      if (!nextSetup || nextSetup.score <= 0) {
        throw new Error('Not enough motion detected. Point the camera at the hive entrance and try again.')
      }

      setSetup(drawSetup(canvasRef.current, video, nextSetup, 'Auto motion line'))
      setSetupStatus('ready')
      setSetupProgress(100)
      setBackendStatus('ready_to_test')
      resetLiveCounters()
    } catch (err) {
      setError(err.message || 'Automatic setup failed.')
      setSetupStatus('waiting')
      setSetupProgress(0)
    } finally {
      samplingRef.current = false
    }
  }

  function clearSetup() {
    stopLiveDetection(status)
    if (!canvasRef.current) return
    const ctx = canvasRef.current.getContext('2d')
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    setSetup(null)
    setSetupStatus(status === 'live' ? 'waiting' : 'not_started')
    setSetupProgress(0)
    setBackendStatus('not_tested')
    resetLiveCounters()
  }

  function flipHiveSide() {
    if (!setup || !videoRef.current || !canvasRef.current || status !== 'live') return
    stopLiveDetection('live')
    const width = videoRef.current.videoWidth || 1280
    const lineX = setup.line_x1
    const currentOffset = setup.hive_x - lineX
    const fallbackOffset = Math.round(width * 0.16)
    const nextOffset = currentOffset === 0 ? fallbackOffset : -currentOffset
    const nextSetup = {
      ...setup,
      hive_x: Math.max(24, Math.min(width - 24, lineX + nextOffset)),
      hive_side_guess: nextOffset < 0 ? 'left' : 'right',
      label: 'Flipped hive side'
    }
    setSetup(drawSetup(canvasRef.current, videoRef.current, nextSetup, 'Auto motion line'))
    setSetupStatus('ready')
    setBackendStatus('ready_to_test')
    resetLiveCounters()
  }

  async function toggleFullscreen() {
    const shell = shellRef.current
    if (!shell) return

    if (document.fullscreenElement || immersive) {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen()
      }
      setImmersive(false)
      return
    }

    try {
      if (shell.requestFullscreen) {
        await shell.requestFullscreen()
      }
      setImmersive(true)
    } catch {
      setImmersive(true)
    }
  }

  async function sendFramePair(prevBlob, frameBlob) {
    const form = new FormData()
    form.append('prev_frame', prevBlob, 'prev.jpg')
    form.append('frame', frameBlob, 'frame.jpg')
    form.append('line_x1', setup.line_x1.toString())
    form.append('line_y1', setup.line_y1.toString())
    form.append('line_x2', setup.line_x2.toString())
    form.append('line_y2', setup.line_y2.toString())
    form.append('hive_x', setup.hive_x.toString())
    form.append('hive_y', setup.hive_y.toString())
    form.append('live_mode', 'true')
    form.append('hybrid_mode', liveMode === 'hybrid' ? 'true' : 'false')
    form.append('yolo_conf', '0.15')
    form.append('include_dark_motion', 'true')
    form.append('use_baseline_gate', liveBaselineBlobRef.current ? 'true' : 'false')
    form.append('stabilize_frame', 'false')
    if (liveBaselineBlobRef.current) {
      form.append('baseline_frame', liveBaselineBlobRef.current, 'baseline.jpg')
    }
    form.append('diff_threshold', sensitivity === 'high' ? '12' : sensitivity === 'low' ? '30' : '18')
    form.append('min_contour_area', sensitivity === 'high' ? '12' : sensitivity === 'low' ? '80' : '30')
    form.append('min_motion_pixels', sensitivity === 'high' ? '35' : sensitivity === 'low' ? '180' : '60')
    form.append('max_motion_pixels', sensitivity === 'high' ? '90000' : sensitivity === 'low' ? '35000' : '60000')

    const data = await postMotionFrame(form)

    setBackendStatus('ok')
    const nextCounts = updateLiveTracks(data.detections || [])
    drawDetections(canvasRef.current, videoRef.current, setup, data.detections || [], data.yolo_detections || [])
    drawLiveCounters(canvasRef.current, nextCounts)
    await publishLiveSession(frameBlob, data, nextCounts)
    return data
  }

  async function publishLiveSession(frameBlob, backendData, nextCounts) {
    if (!setup || !frameBlob) return

    const now = Date.now()
    const countChanged = (
      nextCounts.in !== lastPublishedCountsRef.current.in
      || nextCounts.out !== lastPublishedCountsRef.current.out
    )
    if (!countChanged && now - lastPublishAtRef.current < LIVE_SESSION_PUBLISH_INTERVAL_MS) return

    const form = new FormData()
    form.append('snapshot', frameBlob, 'live.jpg')
    form.append('node_id', nodeId)
    form.append('hive_label', hiveLabel)
    form.append('device_label', 'Phone camera')
    form.append('count_in', nextCounts.in.toString())
    form.append('count_out', nextCounts.out.toString())
    form.append('detections', String(backendData.detections?.length || 0))
    form.append('verified', String(backendData.hybrid?.verified_motion ?? 0))
    form.append('mode', liveMode)
    form.append('sensitivity', sensitivity)
    form.append('line', JSON.stringify({
      x1: setup.line_x1,
      y1: setup.line_y1,
      x2: setup.line_x2,
      y2: setup.line_y2
    }))
    form.append('hive_side', setup.hive_side_guess || (setup.hive_x < setup.line_x1 ? 'left' : 'right'))
    form.append('status', liveDetectionRef.current ? 'live' : 'test')

    try {
      setLivePublishStatus('sending')
      await api.post('/api/live/session', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 12000
      })
      lastPublishAtRef.current = now
      lastPublishedCountsRef.current = nextCounts
      setLivePublishStatus('ok')
    } catch (err) {
      setLivePublishStatus(err.response?.status === 401 ? 'login_required' : 'failed')
    }
  }

  async function publishNodePresence(statusLabel = 'camera') {
    const video = videoRef.current
    if (!video) return

    const form = new FormData()
    form.append('node_id', nodeId)
    form.append('hive_label', hiveLabel)
    form.append('device_label', 'Phone camera')
    form.append('count_in', liveCountsRef.current.in.toString())
    form.append('count_out', liveCountsRef.current.out.toString())
    form.append('detections', '0')
    form.append('verified', '0')
    form.append('mode', liveMode)
    form.append('sensitivity', sensitivity)
    form.append('line', setup ? JSON.stringify({
      x1: setup.line_x1,
      y1: setup.line_y1,
      x2: setup.line_x2,
      y2: setup.line_y2
    }) : '')
    form.append('hive_side', setup ? (setup.hive_side_guess || (setup.hive_x < setup.line_x1 ? 'left' : 'right')) : '')
    form.append('status', statusLabel)

    try {
      if (video.videoWidth && video.videoHeight) {
        const snapshot = await captureFrameBlob(video, 0.5)
        form.append('snapshot', snapshot, 'camera.jpg')
      }
      setLivePublishStatus('sending')
      await api.post('/api/live/session', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 12000
      })
      setLivePublishStatus('ok')
    } catch (err) {
      setLivePublishStatus(err.response?.status === 401 ? 'login_required' : 'failed')
    }
  }

  async function testBackendFrame() {
    if (!videoRef.current || !canvasRef.current || !setup || status !== 'live') return

    setError('')
    setBackendStatus('sending')

    try {
      const reachable = await checkMotionBackendReachable()
      if (!reachable) {
        throw new Error('Motion backend is not reachable from this browser. Reopen the app from the active laptop URL and confirm the phone is on the same network or a working HTTPS tunnel.')
      }
      const prevBlob = await captureFrameBlob(videoRef.current)
      await new Promise(resolve => window.setTimeout(resolve, 220))
      const frameBlob = await captureFrameBlob(videoRef.current)
      await sendFramePair(prevBlob, frameBlob)
    } catch (err) {
      setBackendStatus('failed')
      setError(err.response?.data?.error || err.message || 'Backend frame test failed.')
    }
  }

  async function startLiveDetection() {
    if (!videoRef.current || !canvasRef.current || status !== 'live' || liveDetectionRef.current) return

    if (!setup) {
      setError('Run Auto setup or Draw guide first so the live counter knows where the entrance line is.')
      return
    }

    setError('')
    setBackendStatus('live_running')
    setLiveDetection(true)
    liveDetectionRef.current = true

    let prevBlob
    try {
      const reachable = await checkMotionBackendReachable()
      if (!reachable) {
        setBackendStatus('retrying')
        setError('Motion backend pre-check missed once. Live mode is still running and will keep retrying frames. If this message stays, reopen the active HTTPS tunnel link.')
      }
      setBackendStatus('calibrating')
      setError('Hold the phone still and keep the pen out of view for 1 second. Capturing background baseline.')
      await new Promise(resolve => window.setTimeout(resolve, 900))
      liveBaselineBlobRef.current = await captureFrameBlob(videoRef.current, 0.7)
      setError('Baseline captured. Move the pen across the green line now.')
      setBackendStatus('live_running')
      await new Promise(resolve => window.setTimeout(resolve, 180))
      prevBlob = await captureFrameBlob(videoRef.current, 0.62)
    } catch (err) {
      setError(err.message || 'Could not start live detection.')
      stopLiveDetection('live')
      return
    }

    let consecutiveErrors = 0
    while (liveDetectionRef.current) {
      try {
        await new Promise(resolve => window.setTimeout(resolve, LIVE_DETECTION_INTERVAL_MS))
        if (!liveDetectionRef.current) break

        const frameBlob = await captureFrameBlob(videoRef.current, 0.62)
        await sendFramePair(prevBlob, frameBlob)
        prevBlob = frameBlob
        consecutiveErrors = 0
      } catch (err) {
        consecutiveErrors += 1
        const message = err.response?.data?.error || err.message || 'Live detection failed.'
        if (consecutiveErrors >= LIVE_MAX_CONSECUTIVE_ERRORS) {
          liveDetectionRef.current = false
          setLiveDetection(false)
          setBackendStatus('failed')
          setError(message)
          break
        }

        setBackendStatus('retrying')
        setError(`Live frame retry ${consecutiveErrors}/${LIVE_MAX_CONSECUTIVE_ERRORS}: ${message}`)
        try {
          prevBlob = await captureFrameBlob(videoRef.current, 0.62)
        } catch {
          // Keep the previous frame if the camera is briefly unavailable.
        }
      }
    }
  }

  const backendTestLabel = backendStatus === 'sending' ? 'Checking...' : 'Check motion'
  const liveDetectionLabel = liveDetection ? 'Stop live' : 'Start live'
  const netCount = liveCounts.in - liveCounts.out
  const syncLabel = livePublishStatus === 'published'
    ? 'Dashboard updated'
    : livePublishStatus === 'failed'
      ? 'Sync failed'
      : livePublishStatus === 'login_required'
        ? 'Sign in needed'
        : liveDetection
          ? 'Syncing live'
          : 'Ready'

  useEffect(() => stopCamera, [])

  useEffect(() => {
    window.localStorage.setItem('bee_live_hive_label', hiveLabel)
  }, [hiveLabel])

  useEffect(() => {
    function syncFullscreenState() {
      setImmersive(Boolean(document.fullscreenElement))
    }

    document.addEventListener('fullscreenchange', syncFullscreenState)
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState)
  }, [])

  return (
    <Layout>
      <BeeBackground />
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Phone live gate</h1>
          <p className={s.sub}>Use the phone camera as a field uplink for live entrance counting and dashboard review.</p>
        </div>
        <div className={`${s.liveBadge} ${status === 'live' ? s.liveBadgeOn : ''}`}>
          <span>{status === 'live' ? 'Camera live' : status === 'starting' ? 'Starting camera' : 'Camera idle'}</span>
        </div>
      </div>

      <div className={s.content}>
        {immersive && (
          <div className={s.immersiveDock}>
            <button type="button" className={s.fullscreenPrimary} onClick={startCamera} disabled={status === 'starting' || status === 'live'}>
              {status === 'starting' ? 'Starting...' : 'Start camera'}
            </button>
            <button type="button" className={s.fullscreenPrimary} onClick={refreshGuide} disabled={status !== 'live' || setupStatus === 'sampling'}>
              Draw guide
            </button>
            <select
              className={s.fullscreenSelect}
              value={sensitivity}
              onChange={e => setSensitivity(e.target.value)}
              disabled={liveDetection}
            >
              <option value="low">Low sensitivity</option>
              <option value="normal">Normal sensitivity</option>
              <option value="high">High sensitivity</option>
            </select>
            <button type="button" className={s.fullscreenPrimary} onClick={runAutoSetup} disabled={status !== 'live' || setupStatus === 'sampling'}>
              {setupStatus === 'sampling' ? `Sampling ${setupProgress}%` : 'Auto setup'}
            </button>
            <button type="button" className={s.fullscreenPrimary} onClick={testBackendFrame} disabled={status !== 'live' || !setup || backendStatus === 'sending'}>
              {backendTestLabel}
            </button>
            <button type="button" className={`${s.fullscreenPrimary} ${liveDetection ? s.liveStopButton : s.liveStartButton}`} onClick={toggleLiveDetection} disabled={status !== 'live' || !setup || backendStatus === 'sending'}>
              {liveDetectionLabel}
            </button>
            <button type="button" className={s.fullscreenButton} onClick={clearSetup} disabled={status !== 'live' || setupStatus === 'sampling'}>
              Clear
            </button>
            <button type="button" className={s.fullscreenButton} onClick={flipHiveSide} disabled={status !== 'live' || !setup || setupStatus === 'sampling'}>
              Flip side
            </button>
            <button type="button" className={s.fullscreenButton} onClick={resetLiveCounters} disabled={status !== 'live'}>
              Reset count
            </button>
            <button type="button" className={s.fullscreenButton} onClick={toggleFullscreen}>
              Exit
            </button>
          </div>
        )}
        <section className={s.stagePanel}>
          <div className={s.nodeConfig}>
            <label className={s.nodeField}>
              <span>Hive name</span>
              <input
                className={s.nodeInput}
                value={hiveLabel}
                onChange={event => setHiveLabel(event.target.value)}
                onBlur={() => {
                  if (status === 'live') publishNodePresence(liveDetection ? 'live' : 'camera')
                }}
                maxLength={80}
              />
            </label>
            <div className={s.nodeMeta}>
              <span>Node</span>
              <strong>{nodeId}</strong>
            </div>
          </div>
          <div ref={shellRef} className={`${s.videoShell} ${immersive ? s.videoShellFullscreen : ''}`}>
            <video
              ref={videoRef}
              className={s.video}
              playsInline
              muted
              onLoadedMetadata={refreshGuide}
            />
            <canvas ref={canvasRef} className={s.overlay} />
            <div className={s.stageOverlayActions}>
              <button type="button" className={s.overlayButton} onClick={refreshGuide} disabled={status !== 'live' || setupStatus === 'sampling'}>
                Draw guide
              </button>
              <button type="button" className={s.overlayButton} onClick={toggleFullscreen}>
                {immersive ? 'Exit full screen' : 'Full screen'}
              </button>
            </div>
            {immersive && (
              <div className={s.fullscreenControls}>
                <button type="button" className={s.fullscreenPrimary} onClick={startCamera} disabled={status === 'starting' || status === 'live'}>
                  {status === 'starting' ? 'Starting...' : 'Start camera'}
                </button>
                <button type="button" className={s.fullscreenPrimary} onClick={refreshGuide} disabled={status !== 'live' || setupStatus === 'sampling'}>
                  Draw guide
                </button>
                <select
                  className={s.fullscreenSelect}
                  value={sensitivity}
                  onChange={e => setSensitivity(e.target.value)}
                  disabled={liveDetection}
                >
                  <option value="low">Low sensitivity</option>
                  <option value="normal">Normal sensitivity</option>
                  <option value="high">High sensitivity</option>
                </select>
                <button type="button" className={s.fullscreenPrimary} onClick={runAutoSetup} disabled={status !== 'live' || setupStatus === 'sampling'}>
                  {setupStatus === 'sampling' ? `Sampling ${setupProgress}%` : 'Auto setup'}
                </button>
                <button type="button" className={s.fullscreenPrimary} onClick={testBackendFrame} disabled={status !== 'live' || !setup || backendStatus === 'sending'}>
                  {backendTestLabel}
                </button>
                <button type="button" className={`${s.fullscreenPrimary} ${liveDetection ? s.liveStopButton : s.liveStartButton}`} onClick={toggleLiveDetection} disabled={status !== 'live' || !setup || backendStatus === 'sending'}>
                  {liveDetectionLabel}
                </button>
                <button type="button" className={s.fullscreenButton} onClick={clearSetup} disabled={status !== 'live' || setupStatus === 'sampling'}>
                  Clear
                </button>
                <button type="button" className={s.fullscreenButton} onClick={flipHiveSide} disabled={status !== 'live' || !setup || setupStatus === 'sampling'}>
                  Flip side
                </button>
                <button type="button" className={s.fullscreenButton} onClick={resetLiveCounters} disabled={status !== 'live'}>
                  Reset count
                </button>
                <button type="button" className={s.fullscreenButton} onClick={stopCamera} disabled={status !== 'live'}>
                  Stop
                </button>
              </div>
            )}
            {status !== 'live' && (
              <div className={s.emptyState}>
                <div className={s.emptyTitle}>Camera preview is off</div>
                <div className={s.emptyText}>Start the camera to verify phone hardware access and overlay alignment.</div>
              </div>
            )}
            {status === 'live' && !setup && (
              <div className={s.liveHint}>
                {setupStatus === 'sampling' ? `Sampling motion ${setupProgress}%` : 'Tap Draw guide for a quick test, or Auto setup after pointing at the hive entrance'}
              </div>
            )}
          </div>

          {error && <div className={s.error}>{error}</div>}

          <div className={s.controls}>
            <button className={s.btnPrimary} onClick={startCamera} disabled={status === 'starting' || status === 'live'}>
              {status === 'starting' ? 'Starting...' : 'Start camera'}
            </button>
            <button className={s.btnPrimary} onClick={runAutoSetup} disabled={status !== 'live' || setupStatus === 'sampling'}>
              {setupStatus === 'sampling' ? 'Sampling...' : 'Auto setup'}
            </button>
            <button className={s.btnPrimary} onClick={testBackendFrame} disabled={status !== 'live' || !setup || backendStatus === 'sending'}>
              {backendTestLabel}
            </button>
            <button className={`${s.btnPrimary} ${liveDetection ? s.liveStopButton : s.liveStartButton}`} onClick={toggleLiveDetection} disabled={status !== 'live' || !setup || backendStatus === 'sending'}>
              {liveDetectionLabel}
            </button>
            <button className={s.btnSecondary} onClick={refreshGuide} disabled={status !== 'live' || setupStatus === 'sampling'}>
              Draw guide
            </button>
            <button className={s.btnSecondary} onClick={clearSetup} disabled={status !== 'live' || setupStatus === 'sampling'}>
              Clear line
            </button>
            <button className={s.btnSecondary} onClick={flipHiveSide} disabled={status !== 'live' || !setup || setupStatus === 'sampling'}>
              Flip hive side
            </button>
            <button className={s.btnSecondary} onClick={resetLiveCounters} disabled={status !== 'live'}>
              Reset counters
            </button>
            <select
              className={s.selectControl}
              value={liveMode}
              onChange={e => setLiveMode(e.target.value)}
              disabled={liveDetection}
            >
              <option value="motion">Motion only</option>
              <option value="hybrid">Hybrid YOLO</option>
            </select>
            <select
              className={s.selectControl}
              value={sensitivity}
              onChange={e => setSensitivity(e.target.value)}
              disabled={liveDetection}
            >
              <option value="low">Low sensitivity</option>
              <option value="normal">Normal sensitivity</option>
              <option value="high">High sensitivity</option>
            </select>
            <button className={s.btnSecondary} onClick={toggleFullscreen}>
              {immersive ? 'Exit full screen' : 'Full screen'}
            </button>
            <button className={s.btnSecondary} onClick={stopCamera} disabled={status !== 'live'}>
              Stop camera
            </button>
          </div>
        </section>

        <aside className={s.summaryPanel}>
          <div className={s.panelTitle}>Live count</div>
          <div className={s.countCards}>
            <div className={s.countCard}>
              <span>In</span>
              <strong>{liveCounts.in}</strong>
            </div>
            <div className={s.countCard}>
              <span>Out</span>
              <strong>{liveCounts.out}</strong>
            </div>
            <div className={s.countCard}>
              <span>Net</span>
              <strong>{netCount >= 0 ? '+' : ''}{netCount}</strong>
            </div>
          </div>
          <div className={s.summaryList}>
            <div>
              <span>Camera</span>
              <strong>{status === 'live' ? 'Live' : status === 'starting' ? 'Starting' : 'Idle'}</strong>
            </div>
            <div>
              <span>Counting</span>
              <strong>{liveDetection ? 'Running' : setup ? 'Ready' : 'Needs setup'}</strong>
            </div>
            <div>
              <span>Dashboard</span>
              <strong>{syncLabel}</strong>
            </div>
            <div>
              <span>Hive</span>
              <strong>{hiveLabel || 'Hive 1'}</strong>
            </div>
          </div>
        </aside>
      </div>
    </Layout>
  )
}
