import { useCallback, useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
import BeeBackground from '../components/BeeBackground'
import api from '../api/client'
import { useWorkspace } from '../context/WorkspaceContext'
import s from './FieldOperations.module.css'

function formatDateTime(timestamp) {
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

function formatTime(timestamp, fallback = 'Waiting') {
  if (!timestamp) return fallback
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const QUICK_PROMPTS = [
  'Summarize today activity',
  'Explain latest report',
  'What should I check next?',
  'Compare live nodes',
  'Prepare field notes for farmer'
]

const MODEL_STORAGE_KEY = 'hivegate_ai_model'

export default function FieldOperations() {
  const { assistant } = useWorkspace()
  const [liveSessions, setLiveSessions] = useState([])
  const [selectedNodeId, setSelectedNodeId] = useState(() => window.localStorage.getItem('bee_selected_live_node_id') || '')
  const [liveSession, setLiveSession] = useState(null)
  const [reports, setReports] = useState([])
  const [selectedReport, setSelectedReport] = useState(null)
  const [recentRecords, setRecentRecords] = useState([])
  const messages = assistant.messages
  const setMessages = assistant.setMessages
  const input = assistant.input
  const setInput = assistant.setInput
  const loading = assistant.loading
  const setLoading = assistant.setLoading
  const [pageStatus, setPageStatus] = useState('')
  const [modelConfig, setModelConfig] = useState({ provider: 'groq', default_model: '', models: [] })
  const [selectedModel, setSelectedModel] = useState(() => window.localStorage.getItem(MODEL_STORAGE_KEY) || '')

  const selectedNode = useMemo(
    () => liveSessions.find(session => session.node_id === selectedNodeId) || liveSession,
    [liveSessions, selectedNodeId, liveSession]
  )

  const activeNodeCount = liveSessions.filter(session => session.active).length
  const liveHistory = liveSession?.history || []
  const net = liveSession?.net ?? ((liveSession?.count_in ?? 0) - (liveSession?.count_out ?? 0))
  const selectedModelInfo = useMemo(
    () => modelConfig.models.find(model => model.id === selectedModel),
    [modelConfig.models, selectedModel]
  )

  const loadLiveSessions = useCallback(async () => {
    const { data } = await api.get('/api/live/sessions')
    const sessions = data.sessions || []
    setLiveSessions(sessions)
    setSelectedNodeId(current => {
      if (current && sessions.some(session => session.node_id === current)) return current
      return sessions[0]?.node_id || ''
    })
  }, [])

  const loadLiveSession = useCallback(async () => {
    const query = selectedNodeId ? `?node_id=${encodeURIComponent(selectedNodeId)}` : ''
    const { data } = await api.get(`/api/live/session${query}`)
    setLiveSession(data)
  }, [selectedNodeId])

  const loadReports = useCallback(async () => {
    const { data } = await api.get('/api/reports/recent?limit=6')
    setReports(data.reports || [])
  }, [])

  const loadRecentRecords = useCallback(async () => {
    const { data } = await api.get('/api/counts/recent?limit=5')
    setRecentRecords(data.records || [])
  }, [])

  const loadAgentModels = useCallback(async () => {
    const { data } = await api.get('/api/agent/models')
    const models = data.models || []
    setModelConfig({
      provider: data.provider || 'groq',
      default_model: data.default_model || models[0]?.id || '',
      models,
    })
    setSelectedModel(current => {
      const saved = current || window.localStorage.getItem(MODEL_STORAGE_KEY) || ''
      if (saved && models.some(model => model.id === saved)) return saved
      return data.default_model || models[0]?.id || ''
    })
  }, [])

  useEffect(() => {
    window.localStorage.setItem('bee_selected_live_node_id', selectedNodeId)
  }, [selectedNodeId])

  useEffect(() => {
    if (selectedModel) {
      window.localStorage.setItem(MODEL_STORAGE_KEY, selectedModel)
    }
  }, [selectedModel])

  useEffect(() => {
    loadAgentModels().catch(err => {
      console.error('Failed to load AI models:', err)
      setPageStatus(err.response?.data?.error || 'AI model list failed to load')
    })
  }, [loadAgentModels])

  useEffect(() => {
    let alive = true
    async function loadAll() {
      setPageStatus('Loading field context...')
      try {
        await Promise.all([loadLiveSessions(), loadLiveSession(), loadReports(), loadRecentRecords()])
        if (alive) setPageStatus('')
      } catch (err) {
        console.error('Failed to load field operations:', err)
        if (alive) setPageStatus(err.response?.data?.error || 'Field context failed to load')
      }
    }
    loadAll()
    const timer = window.setInterval(loadAll, 4000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [loadLiveSessions, loadLiveSession, loadReports, loadRecentRecords])

  async function openReport(reportId) {
    if (!reportId) return
    setPageStatus('Opening report...')
    try {
      const { data } = await api.get(`/api/reports/${reportId}`)
      setSelectedReport(data)
      setPageStatus('')
    } catch (err) {
      setPageStatus(err.response?.data?.error || 'Report failed to load')
    }
  }

  async function sendMessage(message = input) {
    const text = message.trim()
    if (!text || loading) return

    setMessages(current => [...current, { role: 'user', text }])
    setInput('')
    setLoading(true)
    try {
      const { data } = await api.post('/api/agent/chat', { message: text, model: selectedModel })
      setMessages(current => [...current, { role: 'assistant', text: data.answer || 'No answer returned.' }])
    } catch (err) {
      const setup = err.response?.data?.setup_hint
      const error = err.response?.data?.error || 'AI assistant failed'
      setMessages(current => [...current, { role: 'assistant', text: setup ? `${error} ${setup}` : error }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <Layout>
      <BeeBackground />
      <div className={s.header}>
        <div>
          <div className={s.kicker}>AI Helper</div>
          <h1 className={s.title}>AI-guided hive operations</h1>
          <p className={s.sub}>A dedicated assistant workspace for checking live node status, reading reports, and turning session data into field actions.</p>
        </div>
        <select className={s.nodeSelect} value={selectedNodeId} onChange={event => setSelectedNodeId(event.target.value)} disabled={!liveSessions.length}>
          {liveSessions.length ? liveSessions.map(session => (
            <option key={session.node_id} value={session.node_id}>
              {session.hive_label || session.node_id}{session.active ? ' (live)' : ' (last)'}
            </option>
          )) : (
            <option value="">No phone nodes</option>
          )}
        </select>
      </div>

      <div className={s.grid}>
        <section className={s.assistantPanel}>
          <div className={s.panelHeader}>
            <div>
              <div className={s.sectionTitle}>AI Helper</div>
              <h2>Field operations assistant</h2>
              {selectedModelInfo && <p>{selectedModelInfo.description}</p>}
            </div>
            <div className={s.modelControls}>
              <span className={s.scope}>Project data only</span>
              <label>
                <span>Model</span>
                <select value={selectedModel} onChange={event => setSelectedModel(event.target.value)} disabled={loading || !modelConfig.models.length}>
                  {modelConfig.models.length ? modelConfig.models.map(model => (
                    <option key={model.id} value={model.id}>{model.label}</option>
                  )) : (
                    <option value="">No models</option>
                  )}
                </select>
              </label>
            </div>
          </div>

          <div className={s.quickPrompts}>
            {QUICK_PROMPTS.map(prompt => (
              <button key={prompt} onClick={() => sendMessage(prompt)} disabled={loading}>
                {prompt}
              </button>
            ))}
          </div>

          <div className={s.chatLog}>
            {messages.map((message, index) => (
              <div key={index} className={`${s.message} ${message.role === 'user' ? s.userMessage : s.assistantMessage}`}>
                {message.text}
              </div>
            ))}
            {loading && <div className={`${s.message} ${s.assistantMessage}`}>Reading live nodes, reports, and saved counts...</div>}
          </div>

          <form
            className={s.askBar}
            onSubmit={event => {
              event.preventDefault()
              sendMessage()
            }}
          >
            <input
              value={input}
              onChange={event => setInput(event.target.value)}
              placeholder="Ask what the farmer should check next..."
            />
            <button disabled={loading || !input.trim()}>Ask</button>
          </form>
        </section>

        <aside className={s.sideStack}>
          <section className={s.card}>
            <div className={s.sectionTitle}>Live Field Context</div>
            <div className={s.metricGrid}>
              <div>
                <span>Active nodes</span>
                <strong>{activeNodeCount}</strong>
              </div>
              <div>
                <span>Total nodes</span>
                <strong>{liveSessions.length}</strong>
              </div>
              <div>
                <span>In</span>
                <strong>{liveSession?.count_in ?? 0}</strong>
              </div>
              <div>
                <span>Out</span>
                <strong>{liveSession?.count_out ?? 0}</strong>
              </div>
            </div>
            <div className={s.contextRows}>
              <div><span>Hive</span><strong>{selectedNode?.hive_label || 'Waiting'}</strong></div>
              <div><span>Node</span><strong>{selectedNode?.node_id || selectedNodeId || 'Waiting'}</strong></div>
              <div><span>Status</span><strong className={selectedNode?.active ? s.ok : ''}>{selectedNode?.active ? 'Live' : 'Waiting'}</strong></div>
              <div><span>Updated</span><strong>{formatTime(liveSession?.updated_at)}</strong></div>
              <div><span>Net</span><strong>{net >= 0 ? '+' : ''}{net}</strong></div>
              <div><span>Samples</span><strong>{liveHistory.length}</strong></div>
            </div>
          </section>

          <section className={s.card}>
            <div className={s.sectionTitle}>Recent Reports</div>
            <div className={s.list}>
              {reports.length ? reports.map(report => (
                <button key={report.id} className={s.reportButton} onClick={() => openReport(report.id)}>
                  <span>{report.title}</span>
                  <strong>{report.status_label}</strong>
                </button>
              )) : (
                <div className={s.empty}>Save a live session to generate farmer reports.</div>
              )}
            </div>
          </section>

          <section className={s.card}>
            <div className={s.sectionTitle}>Saved Count Records</div>
            <div className={s.list}>
              {recentRecords.length ? recentRecords.map(record => (
                <div key={record.id} className={s.recordRow}>
                  <span>{record.date} {record.time}</span>
                  <strong>IN {record.count_in} / OUT {record.count_out}</strong>
                </div>
              )) : (
                <div className={s.empty}>No saved records yet.</div>
              )}
            </div>
          </section>
        </aside>
      </div>

      {selectedReport && (
        <section className={s.reportPanel}>
          <div className={s.panelHeader}>
            <div>
              <div className={s.sectionTitle}>Selected Farmer Report</div>
              <h2>{selectedReport.title}</h2>
              <p>{formatDateTime(selectedReport.created_at)} / {selectedReport.context?.node_id || 'node'}</p>
            </div>
            <span className={s.scope}>{selectedReport.status_label}</span>
          </div>
          <p className={s.reportSummary}>{selectedReport.summary}</p>
          <div className={s.metricGrid}>
            <div><span>In</span><strong>{selectedReport.metrics?.count_in ?? 0}</strong></div>
            <div><span>Out</span><strong>{selectedReport.metrics?.count_out ?? 0}</strong></div>
            <div><span>Net</span><strong>{selectedReport.metrics?.net >= 0 ? '+' : ''}{selectedReport.metrics?.net ?? 0}</strong></div>
            <div><span>Duration</span><strong>{selectedReport.metrics?.duration_label || 'n/a'}</strong></div>
          </div>
          <div className={s.reportColumns}>
            <div>
              <strong>Observations</strong>
              {(selectedReport.observations || []).map((item, index) => <p key={index}>{item}</p>)}
            </div>
            <div>
              <strong>Recommended next check</strong>
              <p>{selectedReport.recommendation}</p>
            </div>
          </div>
        </section>
      )}

      {pageStatus && <div className={s.statusLine}>{pageStatus}</div>}
    </Layout>
  )
}
