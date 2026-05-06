import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { motion, AnimatePresence } from 'framer-motion'
import Layout from '../components/Layout'
import BeeBackground from '../components/BeeBackground'
import api from '../api/client'
import s from './Dashboard.module.css'

const TABS = ['Overview', 'Daily', 'Monthly', 'Yearly']

const EMPTY_READINESS = [
  { label: 'Phone uplink', value: 'Waiting', tone: 'idle' },
  { label: 'Counting source', value: 'No session', tone: 'idle' },
  { label: 'Frame checks', value: '0', tone: 'idle' },
  { label: 'Record state', value: 'Unsaved', tone: 'idle' }
]

const DEFAULT_VALIDATION = {
  trialName: 'FYP trial 1',
  expectedIn: '',
  expectedOut: '',
  notes: ''
}

function readValidationTrial() {
  try {
    return { ...DEFAULT_VALIDATION, ...JSON.parse(window.localStorage.getItem('bee_validation_trial') || '{}') }
  } catch {
    return DEFAULT_VALIDATION
  }
}

function formatLiveLabel(timestamp, fallback) {
  if (!timestamp) return fallback || ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return fallback || timestamp
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatLiveDateTime(timestamp) {
  if (!timestamp) return 'Waiting'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

const Tip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className={s.tip}>
      <div className={s.tipLabel}>{label}</div>
      {payload.map(p => (
        <div key={p.name} className={s.tipRow}>
          <span style={{ color: p.color }}>{p.name}</span>
          <span>{Number(p.value || 0).toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

const ax = {
  tick: { fill: '#7a7060', fontSize: 11, fontFamily: 'var(--font-mono)' },
  axisLine: { stroke: 'var(--border)' },
  tickLine: false
}
const grid = { strokeDasharray: '3 3', stroke: 'var(--border)', vertical: false }

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function slugify(value, fallback = 'hive-report') {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || fallback
}

function parseCount(value) {
  if (value === '' || value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function calculateValidationScore(expectedIn, expectedOut, detectedIn, detectedOut) {
  if (expectedIn == null || expectedOut == null) return null
  const expectedTotal = expectedIn + expectedOut
  const totalError = Math.abs(expectedIn - detectedIn) + Math.abs(expectedOut - detectedOut)
  if (expectedTotal <= 0) {
    return totalError === 0 ? 100 : 0
  }
  return Math.max(0, Math.round((1 - totalError / expectedTotal) * 100))
}

export default function Dashboard() {
  const [tab, setTab] = useState('Overview')
  const [today, setToday] = useState(null)
  const [daily, setDaily] = useState([])
  const [monthly, setMonthly] = useState([])
  const [yearly, setYearly] = useState([])
  const [recentRecords, setRecentRecords] = useState({ total: 0, records: [] })
  const [dailyDays, setDailyDays] = useState(30)
  const [liveSession, setLiveSession] = useState(null)
  const [liveSessions, setLiveSessions] = useState([])
  const [selectedNodeId, setSelectedNodeId] = useState(() => window.localStorage.getItem('bee_selected_live_node_id') || '')
  const [reports, setReports] = useState([])
  const [selectedReport, setSelectedReport] = useState(null)
  const [demoReadiness, setDemoReadiness] = useState(null)
  const [validationTrial, setValidationTrial] = useState(readValidationTrial)
  const [reportStatus, setReportStatus] = useState('')
  const [savingLive, setSavingLive] = useState(false)
  const [saveLiveStatus, setSaveLiveStatus] = useState('')
  const [recordAction, setRecordAction] = useState('')
  const [loading, setLoading] = useState(true)

  const loadToday = useCallback(async () => {
    const { data } = await api.get('/api/counts/today')
    setToday(data)
  }, [])
  const loadDaily = useCallback(async (d = dailyDays) => {
    const { data } = await api.get(`/api/counts/daily?days=${d}`)
    setDaily(data)
  }, [dailyDays])
  const loadMonthly = useCallback(async () => {
    const { data } = await api.get('/api/counts/monthly')
    setMonthly(data)
  }, [])
  const loadYearly = useCallback(async () => {
    const { data } = await api.get('/api/counts/yearly')
    setYearly(data)
  }, [])
  const loadRecentRecords = useCallback(async () => {
    const { data } = await api.get('/api/counts/recent?limit=8')
    setRecentRecords(data)
  }, [])
  const loadLiveSessions = useCallback(async () => {
    const { data } = await api.get('/api/live/sessions')
    const sessions = data.sessions || []
    setLiveSessions(sessions)
    setSelectedNodeId(current => {
      const currentSession = sessions.find(session => session.node_id === current)
      if (currentSession?.active) return current
      const activeSession = sessions.find(session => session.active)
      if (activeSession?.node_id) return activeSession.node_id
      if (currentSession) return current
      return sessions[0]?.node_id || ''
    })
  }, [])
  const loadLiveSession = useCallback(async () => {
    const query = selectedNodeId ? `?node_id=${encodeURIComponent(selectedNodeId)}` : ''
    const { data } = await api.get(`/api/live/session${query}`)
    setLiveSession(data)
  }, [selectedNodeId])
  const loadReports = useCallback(async () => {
    const { data } = await api.get('/api/reports/recent?limit=5')
    setReports(data.reports || [])
  }, [])
  const loadDemoReadiness = useCallback(async () => {
    const { data } = await api.get('/api/demo/readiness')
    setDemoReadiness(data)
  }, [])

  const refreshDashboardData = useCallback(async (days = dailyDays) => {
    await Promise.all([
      loadToday(),
      loadDaily(days),
      loadMonthly(),
      loadYearly(),
      loadRecentRecords(),
      loadReports(),
      loadDemoReadiness()
    ])
  }, [dailyDays, loadToday, loadDaily, loadMonthly, loadYearly, loadRecentRecords, loadReports, loadDemoReadiness])

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        await refreshDashboardData(7)
      } catch (err) {
        console.error('Failed to load dashboard data:', err)
      }
      setLoading(false)
    })()
  }, [refreshDashboardData])

  useEffect(() => { if (tab === 'Daily') loadDaily(dailyDays).catch(console.error) }, [tab, dailyDays, loadDaily])
  useEffect(() => { if (tab === 'Monthly') loadMonthly().catch(console.error) }, [tab, loadMonthly])
  useEffect(() => { if (tab === 'Yearly') loadYearly().catch(console.error) }, [tab, loadYearly])
  useEffect(() => {
    if (tab !== 'Overview') return undefined
    loadLiveSessions().catch(console.error)
    loadLiveSession().catch(console.error)
    const timer = window.setInterval(() => {
      loadLiveSessions().catch(console.error)
      loadLiveSession().catch(console.error)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [tab, loadLiveSessions, loadLiveSession])

  useEffect(() => {
    window.localStorage.setItem('bee_selected_live_node_id', selectedNodeId)
  }, [selectedNodeId])

  async function saveLiveSession() {
    if (!hasLiveHistory || savingLive) return

    setSavingLive(true)
    setSaveLiveStatus('')
    try {
      const { data } = await api.post('/api/live/session/save', { node_id: selectedNodeId })
      setSaveLiveStatus(data.already_saved ? 'Report opened for saved session' : 'Saved + report generated')
      if (data.report) setSelectedReport(data.report)
      await Promise.all([
        refreshDashboardData(dailyDays),
        loadLiveSessions(),
        loadLiveSession(),
        loadDemoReadiness()
      ])
    } catch (err) {
      setSaveLiveStatus(err.response?.data?.error || 'Save failed')
    } finally {
      setSavingLive(false)
    }
  }

  async function openReport(reportId) {
    if (!reportId) return
    setReportStatus('Loading report...')
    try {
      const { data } = await api.get(`/api/reports/${reportId}`)
      setSelectedReport(data)
      setReportStatus('')
    } catch (err) {
      setReportStatus(err.response?.data?.error || 'Report failed to load')
    }
  }

  function printReport() {
    if (!selectedReport) return
    window.print()
  }

  function downloadReportHtml() {
    if (!selectedReport) return

    const metrics = selectedReport.metrics || {}
    const context = selectedReport.context || {}
    const observations = selectedReport.observations || []
    const generatedAt = formatLiveDateTime(selectedReport.created_at)
    const title = selectedReport.title || 'Hive farmer report'
    const filename = `${slugify(title)}-${new Date().toISOString().slice(0, 10)}.html`
    const net = metrics.net ?? 0
    const rows = [
      ['In crossings', metrics.count_in ?? 0],
      ['Out crossings', metrics.count_out ?? 0],
      ['Net movement', `${net >= 0 ? '+' : ''}${net}`],
      ['Duration', metrics.duration_label || 'n/a'],
      ['Hive', context.hive_label || 'Unassigned hive'],
      ['Node', context.node_id || 'Unknown node'],
      ['Mode', context.mode || 'motion'],
      ['Sensitivity', context.sensitivity || 'normal']
    ]

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; background: #f7f4ed; color: #211b12; font-family: Arial, sans-serif; }
    main { max-width: 860px; margin: 0 auto; padding: 34px 22px 44px; }
    header { border-bottom: 4px solid #d99a25; padding-bottom: 18px; margin-bottom: 22px; }
    .eyebrow { color: #7b5a17; font-size: 12px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
    h1 { margin: 8px 0 8px; font-size: 30px; line-height: 1.1; }
    .meta { color: #6f6659; font-size: 13px; font-weight: 700; }
    .pill { display: inline-block; margin: 4px 0 18px; padding: 8px 11px; border-radius: 999px; background: #e7f3eb; color: #246f49; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .summary { background: #fff; border: 1px solid #e4dccf; border-radius: 10px; padding: 18px; font-size: 15px; line-height: 1.6; font-weight: 700; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 18px 0; }
    .metric { background: #fff; border: 1px solid #e4dccf; border-radius: 10px; padding: 13px; }
    .metric span { display: block; color: #746b5f; font-size: 11px; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; }
    .metric strong { display: block; margin-top: 6px; font-size: 21px; }
    section { background: #fff; border: 1px solid #e4dccf; border-radius: 10px; padding: 18px; margin-top: 14px; }
    h2 { margin: 0 0 10px; font-size: 17px; }
    p, li { color: #4d453b; font-size: 14px; line-height: 1.6; font-weight: 650; }
    ul { margin: 0; padding-left: 19px; }
    footer { margin-top: 22px; color: #857b6d; font-size: 12px; }
    @media (max-width: 720px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } h1 { font-size: 24px; } }
    @media print { body { background: #fff; } main { max-width: none; padding: 20px; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="eyebrow">HiveGate farmer report</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">Generated ${escapeHtml(generatedAt)} / ${escapeHtml(context.node_id || 'node')}</div>
    </header>
    <div class="pill">${escapeHtml(selectedReport.status_label || 'Report')}</div>
    <div class="summary">${escapeHtml(selectedReport.summary || 'No summary available.')}</div>
    <div class="grid">
      ${rows.slice(0, 4).map(([label, value]) => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}
    </div>
    <section>
      <h2>Session Context</h2>
      <div class="grid">
        ${rows.slice(4).map(([label, value]) => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}
      </div>
    </section>
    <section>
      <h2>Observations</h2>
      ${observations.length ? `<ul>${observations.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p>No observations available.</p>'}
    </section>
    <section>
      <h2>Recommended Next Check</h2>
      <p>${escapeHtml(selectedReport.recommendation || 'Review the next live session before making hive management decisions.')}</p>
    </section>
    <footer>Exported from HiveGate command center. Keep this report with the matching CSV or JSON export for audit review.</footer>
  </main>
</body>
</html>`

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  async function deleteRecord(record) {
    const ok = window.confirm(`Delete saved record from ${formatLiveDateTime(record.timestamp)}?`)
    if (!ok) return

    setRecordAction(`Deleting record #${record.id}...`)
    try {
      await api.delete(`/api/counts/${record.id}`)
      setRecordAction('Record deleted')
      await Promise.all([
        refreshDashboardData(dailyDays),
        loadLiveSessions(),
        loadLiveSession(),
        loadDemoReadiness()
      ])
    } catch (err) {
      setRecordAction(err.response?.data?.error || 'Delete failed')
    }
  }

  async function clearAllRecords() {
    const ok = window.confirm(`Delete all ${recentRecords.total || 0} saved count records? This cannot be undone.`)
    if (!ok) return

    setRecordAction('Clearing saved records...')
    try {
      const { data } = await api.delete('/api/counts')
      setRecordAction(`Cleared ${data.deleted || 0} records`)
      await Promise.all([
        refreshDashboardData(dailyDays),
        loadLiveSessions(),
        loadLiveSession(),
        loadDemoReadiness()
      ])
    } catch (err) {
      setRecordAction(err.response?.data?.error || 'Clear failed')
    }
  }

  function downloadLive(format) {
    if (!liveSession) return

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const hiveSlug = (liveSession.hive_label || 'live-session').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'live-session'
    let blob
    let filename
    if (format === 'csv') {
      const rows = [
        ['timestamp', 'time', 'in', 'out', 'net', 'detections', 'verified', 'mode', 'sensitivity'],
        ...(liveSession.history || []).map(row => [
          row.timestamp || '',
          row.time || '',
          row.in ?? 0,
          row.out ?? 0,
          row.net ?? 0,
          row.detections ?? 0,
          row.verified ?? 0,
          row.mode || '',
          row.sensitivity || ''
        ])
      ]
      const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n')
      blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      filename = `${hiveSlug}-${stamp}.csv`
    } else {
      blob = new Blob([JSON.stringify(liveSession, null, 2)], { type: 'application/json;charset=utf-8' })
      filename = `${hiveSlug}-${stamp}.json`
    }

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  function updateValidationTrial(patch) {
    setValidationTrial(current => {
      const next = { ...current, ...patch }
      window.localStorage.setItem('bee_validation_trial', JSON.stringify(next))
      return next
    })
  }

  function downloadValidationEvidence() {
    const detectedIn = Number(liveSession?.count_in || 0)
    const detectedOut = Number(liveSession?.count_out || 0)
    const expectedIn = parseCount(validationTrial.expectedIn)
    const expectedOut = parseCount(validationTrial.expectedOut)
    const score = calculateValidationScore(expectedIn, expectedOut, detectedIn, detectedOut)
    const payload = {
      trial_name: validationTrial.trialName,
      exported_at: new Date().toISOString(),
      hive_label: liveSession?.hive_label || selectedLiveNode?.hive_label || 'Unassigned hive',
      node_id: liveSession?.node_id || selectedNodeId || 'unknown',
      expected: { in: expectedIn, out: expectedOut },
      detected: { in: detectedIn, out: detectedOut },
      error: expectedIn == null || expectedOut == null ? null : {
        in: detectedIn - expectedIn,
        out: detectedOut - expectedOut,
      },
      accuracy_percent: score,
      notes: validationTrial.notes,
      live_session: liveSession || null,
      demo_readiness: demoReadiness || null,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${slugify(validationTrial.trialName, 'fyp-validation')}-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const liveHistory = useMemo(() => (
    (liveSession?.history || []).map(row => ({
      ...row,
      label: formatLiveLabel(row.timestamp, row.time)
    }))
  ), [liveSession?.history])
  const hasLiveHistory = liveHistory.length > 0
  const liveActive = Boolean(liveSession?.active)
  const selectedLiveNode = useMemo(
    () => liveSessions.find(session => session.node_id === selectedNodeId) || liveSession,
    [liveSessions, selectedNodeId, liveSession]
  )
  const liveAlreadySaved = Boolean(liveSession?.saved)
  const overviewIn = hasLiveHistory ? liveSession.count_in : today?.total_in
  const overviewOut = hasLiveHistory ? liveSession.count_out : today?.total_out
  const overviewNet = hasLiveHistory ? liveSession.net : today?.net
  const lastEvent = liveSession?.updated_at ? formatLiveLabel(liveSession.updated_at) : 'Waiting'
  const chartData = hasLiveHistory ? liveHistory : daily
  const chartXKey = hasLiveHistory ? 'label' : 'date'
  const readiness = useMemo(() => (
    hasLiveHistory ? [
      { label: 'Phone uplink', value: liveActive ? 'Fresh' : 'Last frame', tone: liveActive ? 'ok' : 'warn' },
      { label: 'Counting source', value: liveSession?.mode === 'hybrid' ? 'Hybrid YOLO' : 'Motion', tone: 'ok' },
      { label: 'Frame checks', value: String(liveHistory.length), tone: 'ok' },
      { label: 'Record state', value: liveAlreadySaved ? 'Saved' : 'Ready to save', tone: liveAlreadySaved ? 'ok' : 'warn' }
    ] : EMPTY_READINESS
  ), [hasLiveHistory, liveActive, liveSession?.mode, liveHistory.length, liveAlreadySaved])

  const expectedIn = parseCount(validationTrial.expectedIn)
  const expectedOut = parseCount(validationTrial.expectedOut)
  const detectedIn = Number(liveSession?.count_in || 0)
  const detectedOut = Number(liveSession?.count_out || 0)
  const validationScore = calculateValidationScore(expectedIn, expectedOut, detectedIn, detectedOut)
  const validationReady = expectedIn != null && expectedOut != null && hasLiveHistory

  const selectedReportCard = selectedReport && (
    <div className={`${s.card} ${s.printableReport}`}>
      <div className={s.reportTop}>
        <div>
          <div className={s.sectionTitle}>Farmer Report</div>
          <h2 className={s.reportTitle}>{selectedReport.title}</h2>
          <div className={s.reportMetaLine}>
            {formatLiveDateTime(selectedReport.created_at)} / {selectedReport.context?.node_id || 'node'}
          </div>
        </div>
        <div className={s.reportActions}>
          <button className={s.cameraActionBtn} onClick={downloadReportHtml}>Download Report</button>
          <button className={s.cameraActionBtn} onClick={printReport}>Print</button>
        </div>
      </div>
      <div className={s.reportStatusPill}>{selectedReport.status_label}</div>
      <p className={s.reportSummary}>{selectedReport.summary}</p>
      <div className={s.reportMetricGrid}>
        <div><span>In</span><strong>{selectedReport.metrics?.count_in ?? 0}</strong></div>
        <div><span>Out</span><strong>{selectedReport.metrics?.count_out ?? 0}</strong></div>
        <div><span>Net</span><strong>{selectedReport.metrics?.net >= 0 ? '+' : ''}{selectedReport.metrics?.net ?? 0}</strong></div>
        <div><span>Duration</span><strong>{selectedReport.metrics?.duration_label || 'n/a'}</strong></div>
      </div>
      <div className={s.reportSection}>
        <strong>Observations</strong>
        {(selectedReport.observations || []).map((item, index) => (
          <p key={index}>{item}</p>
        ))}
      </div>
      <div className={s.reportSection}>
        <strong>Recommended next check</strong>
        <p>{selectedReport.recommendation}</p>
      </div>
    </div>
  )

  return (
    <Layout>
      <BeeBackground />
      <div className={s.header}>
        <div>
          <div className={`${s.liveIndicator} ${liveActive ? s.liveIndicatorOn : ''}`}>
            <div className={s.ping} />
            {liveActive ? 'Phone Feed Live' : 'Overview'}
          </div>
          <h1 className={s.title}>
            {tab === 'Overview' ? 'Hive entrance command center' : `${tab} Traffic Record`}
          </h1>
          <p className={s.sub}>
            {tab === 'Overview' && 'Entrance-level traffic, phone camera evidence, and saved count records in one operator view.'}
            {tab === 'Daily' && 'Day-by-day entrance traffic for trial review and field notes.'}
            {tab === 'Monthly' && 'Monthly traffic patterns for hive activity comparison.'}
            {tab === 'Yearly' && 'Long-term movement records for colony trend analysis.'}
          </p>
        </div>
        <div className={s.headerControls} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className={s.tabGroup} style={{ display: 'flex', background: 'var(--card)', padding: 4, borderRadius: 12, border: '1px solid var(--border)' }}>
            {TABS.map(t => (
              <button key={t} className={`${s.tabBtn} ${tab === t ? s.tabActive : ''}`} onClick={() => setTab(t)} style={{ border: 'none', boxShadow: 'none' }}>{t}</button>
            ))}
          </div>
          {tab === 'Overview' && (
            <>
              <select className={s.sel} value={selectedNodeId} onChange={e => setSelectedNodeId(e.target.value)} disabled={!liveSessions.length}>
                {liveSessions.length ? liveSessions.map(session => (
                  <option key={session.node_id} value={session.node_id}>
                    {session.hive_label || session.node_id}{session.active ? ' (live)' : ' (last)'}
                  </option>
                )) : (
                  <option value="">No phone nodes</option>
                )}
              </select>
            </>
          )}
          {tab === 'Daily' && (
            <select className={s.sel} value={dailyDays} onChange={e => setDailyDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </select>
          )}
        </div>
      </div>

      {loading ? <div className={s.loading}>Analyzing hive data...</div> : (
        <div className={`${s.dashboardGrid} fade-in`}>
          <div className={s.mainContent}>
            <AnimatePresence mode="wait">
              {tab === 'Overview' && (
                <motion.div
                  key="overview"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                  style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
                >
                  <div className={s.liveCameraCard}>
                    <div className={s.cameraHeader}>
                      <div className={s.cameraTitle}>
                        <div className={`${s.recDot} ${liveActive ? s.recDotOn : s.recDotOff}`} />
                        {selectedLiveNode?.hive_label || 'Entrance Camera Uplink'}
                      </div>
                      <div className={s.cameraActions}>
                        <button className={`${s.cameraActionBtn} ${s.cameraSaveBtn}`} onClick={saveLiveSession} disabled={!hasLiveHistory || savingLive}>
                          {savingLive ? 'Saving...' : liveAlreadySaved ? 'Open Report' : 'Save Session'}
                        </button>
                        <button className={s.cameraActionBtn} onClick={() => downloadLive('csv')} disabled={!hasLiveHistory}>Export CSV</button>
                        <button className={s.cameraActionBtn} onClick={() => downloadLive('json')} disabled={!liveSession}>Export JSON</button>
                      </div>
                    </div>
                    <div className={s.cameraStream}>
                      {liveSession?.snapshot ? (
                        <img className={s.cameraSnapshot} src={liveSession.snapshot} alt="Latest phone camera frame" />
                      ) : (
                        <div className={s.cameraEmpty}>
                          <strong>No phone feed yet</strong>
                          <span>Start Live Camera on the phone, run auto setup, then begin live tracking.</span>
                        </div>
                      )}
                      <div className={s.cameraInfo}>
                        <span>{liveActive ? 'Live' : hasLiveHistory ? 'Last frame' : 'Waiting'}</span>
                        <span>{liveSession?.node_id || selectedNodeId || 'No node selected'}</span>
                        <span>{formatLiveDateTime(liveSession?.updated_at)}</span>
                        <span>{liveSession?.mode || 'motion'} / {liveSession?.sensitivity || 'normal'}</span>
                      </div>
                    </div>
                    {saveLiveStatus && <div className={s.saveStatus}>{saveLiveStatus}</div>}
                  </div>

                  {selectedReportCard}

                  <div className={s.statGrid}>
                    {[
                      { label: 'Inbound Crossings', val: overviewIn, cls: s.green, desc: hasLiveHistory ? selectedLiveNode?.hive_label || 'Selected hive' : 'Saved today' },
                      { label: 'Outbound Crossings', val: overviewOut, cls: s.red, desc: hasLiveHistory ? selectedLiveNode?.hive_label || 'Selected hive' : 'Saved today' },
                      {
                        label: 'Net Movement',
                        val: overviewNet != null ? `${overviewNet >= 0 ? '+' : ''}${overviewNet}` : null,
                        cls: overviewNet >= 0 ? s.green : s.red,
                        desc: 'In minus out'
                      },
                      { label: 'Last Frame', val: lastEvent, cls: s.plain, desc: liveActive ? 'Receiving frames' : 'Recent sync' }
                    ].map(c => (
                      <div key={c.label} className={s.statCard}>
                        <div className={s.statLabel}>{c.label}</div>
                        <div className={`${s.statVal} ${c.cls}`}>{c.val ?? '-'}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8, fontWeight: 700, letterSpacing: '0.02em' }}>{c.desc}</div>
                      </div>
                    ))}
                  </div>

                  <div className={s.readinessStrip}>
                    {readiness.map(item => (
                      <div key={item.label} className={s.readinessItem}>
                        <span className={`${s.readinessDot} ${item.tone === 'ok' ? s.readinessOk : item.tone === 'warn' ? s.readinessWarn : ''}`} />
                        <div>
                          <div className={s.readinessLabel}>{item.label}</div>
                          <div className={s.readinessValue}>{item.value}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className={s.validationPanel}>
                    <div className={s.validationHeader}>
                      <div>
                        <div className={s.sectionTitle}>FYP Validation Trial</div>
                        <h2 className={s.validationTitle}>Compare detected traffic with manual ground truth</h2>
                        <p className={s.validationSub}>Use this after one controlled test video or phone trial. Enter the true counts you observed manually, then export the evidence JSON for your report appendix.</p>
                      </div>
                      <button className={s.cameraActionBtn} onClick={downloadValidationEvidence} disabled={!hasLiveHistory}>
                        Export Evidence
                      </button>
                    </div>
                    <div className={s.validationGrid}>
                      <label className={s.validationField}>
                        <span>Trial name</span>
                        <input value={validationTrial.trialName} onChange={e => updateValidationTrial({ trialName: e.target.value })} />
                      </label>
                      <label className={s.validationField}>
                        <span>Expected IN</span>
                        <input type="number" min="0" value={validationTrial.expectedIn} onChange={e => updateValidationTrial({ expectedIn: e.target.value })} placeholder="Manual count" />
                      </label>
                      <label className={s.validationField}>
                        <span>Expected OUT</span>
                        <input type="number" min="0" value={validationTrial.expectedOut} onChange={e => updateValidationTrial({ expectedOut: e.target.value })} placeholder="Manual count" />
                      </label>
                    </div>
                    <div className={s.validationMetrics}>
                      <div><span>Detected IN</span><strong>{detectedIn}</strong></div>
                      <div><span>Detected OUT</span><strong>{detectedOut}</strong></div>
                      <div><span>Accuracy</span><strong>{validationScore == null ? 'Add truth' : `${validationScore}%`}</strong></div>
                      <div><span>Status</span><strong>{validationReady ? 'Evidence ready' : hasLiveHistory ? 'Need truth' : 'Need live session'}</strong></div>
                    </div>
                    <label className={s.validationNotes}>
                      <span>Validation notes</span>
                      <textarea value={validationTrial.notes} onChange={e => updateValidationTrial({ notes: e.target.value })} placeholder="Example: laptop-screen test, fast bee missed, false detection near entrance..." />
                    </label>
                  </div>

                  <div className={s.card}>
                    <div className={s.chartTitle}>
                      Entrance Traffic Timeline
                      <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500, fontFamily: 'var(--font-mono)' }}>
                        {liveActive ? 'LIVE_SYNC_OK' : 'WAITING_FOR_PHONE'}
                      </span>
                    </div>
                    <ResponsiveContainer width="100%" height={260}>
                      <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid {...grid} />
                        <XAxis dataKey={chartXKey} tickFormatter={v => hasLiveHistory ? v : String(v).slice(5)} {...ax} />
                        <YAxis {...ax} />
                        <Tooltip content={<Tip />} cursor={{ stroke: 'var(--amber)', strokeWidth: 1 }} />
                        <Legend iconType="circle" wrapperStyle={{ fontSize: 11, color: 'var(--muted)', paddingTop: 20, fontWeight: 600 }} />
                        <Line type="monotone" dataKey="in" name="Inbound" stroke="var(--green)" strokeWidth={3} dot={{ r: 4, fill: 'var(--green)', strokeWidth: 0 }} activeDot={{ r: 6, stroke: 'var(--surface)', strokeWidth: 2 }} />
                        <Line type="monotone" dataKey="out" name="Outbound" stroke="var(--red)" strokeWidth={3} dot={{ r: 4, fill: 'var(--red)', strokeWidth: 0 }} activeDot={{ r: 6, stroke: 'var(--surface)', strokeWidth: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                </motion.div>
              )}

              {(tab === 'Daily' || tab === 'Monthly' || tab === 'Yearly') && (
                <motion.div
                  key="other-tabs"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                  className={s.card}
                >
                  <div className={s.chartTitle}>{tab} Historical Record</div>
                  <ResponsiveContainer width="100%" height={340}>
                    <BarChart data={tab === 'Daily' ? daily : (tab === 'Monthly' ? monthly : yearly)} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid {...grid} />
                      <XAxis dataKey={tab === 'Daily' ? 'date' : (tab === 'Monthly' ? 'month' : 'year')} tickFormatter={v => tab === 'Daily' ? v.slice(5) : v} {...ax} />
                      <YAxis {...ax} />
                      <Tooltip content={<Tip />} cursor={{ fill: 'var(--amber-dim)' }} />
                      <Legend iconType="rect" wrapperStyle={{ fontSize: 11, color: 'var(--muted)', paddingTop: 20, fontWeight: 600 }} />
                      <Bar dataKey="in" name="Inbound" fill="var(--green)" radius={[4, 4, 0, 0]} barSize={tab === 'Daily' ? 20 : 40} />
                      <Bar dataKey="out" name="Outbound" fill="var(--red)" radius={[4, 4, 0, 0]} barSize={tab === 'Daily' ? 20 : 40} />
                    </BarChart>
                  </ResponsiveContainer>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className={s.sidebar}>
            <div className={s.climateCard}>
              <div className={s.sectionTitle} style={{ color: 'var(--amber)', marginBottom: 12 }}>
                Field Conditions
              </div>
              <div className={s.climateGrid}>
                <div className={s.climateItem}>
                  <div className={s.climateValue}>28C</div>
                  <div className={s.climateLabel}>Temp</div>
                </div>
                <div className={s.climateItem}>
                  <div className={s.climateValue}>64%</div>
                  <div className={s.climateLabel}>Humidity</div>
                </div>
              </div>
              <div className={s.vitalRow} style={{ border: 'none', padding: 0 }}>
                <span className={s.vitalLabel}>Conditions</span>
                <span className={s.vitalVal} style={{ color: 'var(--amber)' }}>Manual</span>
              </div>
            </div>

            <div className={s.card}>
              <div className={s.sectionTitle}>Live Session</div>
              <div className={s.vitals}>
                <div className={s.vitalRow}>
                  <span className={s.vitalLabel}>Hive</span>
                  <span className={s.vitalVal}>{selectedLiveNode?.hive_label || 'Waiting'}</span>
                </div>
                <div className={s.vitalRow}>
                  <span className={s.vitalLabel}>Node</span>
                  <span className={s.vitalVal}>{liveSession?.node_id || selectedNodeId || 'Waiting'}</span>
                </div>
                <div className={s.vitalRow}>
                  <span className={s.vitalLabel}>Status</span>
                  <span className={s.vitalVal} style={{ color: liveActive ? 'var(--green)' : 'var(--muted)' }}>{liveActive ? 'Active' : 'Waiting'}</span>
                </div>
                <div className={s.vitalRow}>
                  <span className={s.vitalLabel}>Updated</span>
                  <span className={s.vitalVal}>{formatLiveLabel(liveSession?.updated_at) || 'Waiting'}</span>
                </div>
                <div className={s.vitalRow}>
                  <span className={s.vitalLabel}>Detections</span>
                  <span className={s.vitalVal}>{liveSession?.detections ?? 0}</span>
                </div>
                <div className={s.vitalRow}>
                  <span className={s.vitalLabel}>Verified</span>
                  <span className={s.vitalVal}>{liveSession?.verified ?? 0}</span>
                </div>
                <div className={s.vitalRow} style={{ border: 'none' }}>
                  <span className={s.vitalLabel}>Hive Side</span>
                  <span className={s.vitalVal}>{liveSession?.hive_side || 'Waiting'}</span>
                </div>
                <div className={s.vitalRow} style={{ border: 'none' }}>
                  <span className={s.vitalLabel}>Saved</span>
                  <span className={s.vitalVal} style={{ color: liveAlreadySaved ? 'var(--green)' : 'var(--muted)' }}>{liveAlreadySaved ? 'Yes' : 'No'}</span>
                </div>
              </div>
            </div>

            <div className={s.card}>
              <div className={s.recordHeader}>
                <div className={s.sectionTitle}>Demo Readiness</div>
                <button className={s.cameraActionBtn} onClick={loadDemoReadiness}>
                  Check
                </button>
              </div>
              <div className={s.demoScore}>
                <strong>{demoReadiness?.readiness_percent ?? 0}%</strong>
                <span>{demoReadiness?.status || 'Waiting for check'}</span>
              </div>
              <div className={s.demoChecklist}>
                {(demoReadiness?.checks || []).map(check => (
                  <div key={check.id} className={s.demoCheckItem}>
                    <span className={`${s.readinessDot} ${check.status === 'ready' ? s.readinessOk : check.status === 'warn' ? s.readinessWarn : ''}`} />
                    <div>
                      <strong>{check.label}</strong>
                      <p>{check.detail}</p>
                    </div>
                  </div>
                ))}
                {!demoReadiness?.checks?.length && (
                  <div className={s.emptyRecords}>Click Check before your demo.</div>
                )}
              </div>
            </div>

            <div className={s.card}>
              <div className={s.recordHeader}>
                <div className={s.sectionTitle}>Saved Records</div>
                <button className={s.dangerMiniBtn} onClick={clearAllRecords} disabled={!recentRecords.total}>
                  Clear all
                </button>
              </div>
              <div className={s.recordMeta}>{recentRecords.total || 0} total saved records</div>
              <div className={s.recordList}>
                {recentRecords.records?.length ? recentRecords.records.map(record => (
                  <div key={record.id} className={s.recordItem}>
                    <div>
                      <div className={s.recordMain}>{record.date} {record.time}</div>
                      <div className={s.recordSub}>IN {record.count_in} / OUT {record.count_out} / NET {record.net >= 0 ? '+' : ''}{record.net}</div>
                    </div>
                    <button className={s.deleteRecordBtn} onClick={() => deleteRecord(record)}>
                      Delete
                    </button>
                  </div>
                )) : (
                  <div className={s.emptyRecords}>No saved count records yet.</div>
                )}
              </div>
              {recordAction && <div className={s.recordAction}>{recordAction}</div>}
            </div>

            <div className={s.card}>
              <div className={s.recordHeader}>
                <div className={s.sectionTitle}>Farmer Reports</div>
                {selectedReport && (
                  <button className={s.cameraActionBtn} onClick={downloadReportHtml}>
                    Download
                  </button>
                )}
              </div>
              <div className={s.recordMeta}>{reports.length || 0} recent generated reports</div>
              <div className={s.recordList}>
                {reports.length ? reports.map(report => (
                  <button key={report.id} className={s.reportListItem} onClick={() => openReport(report.id)}>
                    <span>{report.title}</span>
                    <strong>{report.status_label}</strong>
                  </button>
                )) : (
                  <div className={s.emptyRecords}>Save a live session to generate the first farmer report.</div>
                )}
              </div>
              {reportStatus && <div className={s.recordAction}>{reportStatus}</div>}
            </div>

            <div className={s.card}>
              <div className={s.sectionTitle}>Data Handoff</div>
              <div className={s.feed}>
                <div className={s.feedItem}>
                  <div className={s.feedBody}>
                    <div className={s.feedTitle}>CSV analysis file</div>
                    <div className={s.feedMeta}>Timestamped in/out rows for spreadsheet analysis.</div>
                  </div>
                </div>
                <div className={s.feedItem}>
                  <div className={s.feedBody}>
                    <div className={s.feedTitle}>JSON audit file</div>
                    <div className={s.feedMeta}>Full live snapshot, state, and history payload.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
