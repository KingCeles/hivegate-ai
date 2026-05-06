import { useCallback, useEffect, useState } from 'react'
import Layout from '../components/Layout'
import BeeBackground from '../components/BeeBackground'
import { motion } from 'framer-motion'
import api from '../api/client'
import s from './Hardware.module.css'

const MOCK_NODES = [
  {
    id: 'pi-01',
    name: 'Hive Alpha - Main Node',
    ip: '192.168.1.104',
    status: 'online',
    uptime: '14d 2h 45m',
    cpu: 42,
    ram: 68,
    temp: 54.2,
    sensors: [
      { name: 'BME280 climate probe', status: 'ok', icon: 'CLM' },
      { name: 'HX711 weight bridge', status: 'ok', icon: 'WT' },
      { name: 'Pi Camera V2', status: 'ok', icon: 'CAM' }
    ]
  },
  {
    id: 'pi-02',
    name: 'Hive Beta - Edge Node',
    ip: '192.168.1.105',
    status: 'online',
    uptime: '5d 12h 10m',
    cpu: 85,
    ram: 92,
    temp: 72.1,
    sensors: [
      { name: 'BME280 climate probe', status: 'ok', icon: 'CLM' },
      { name: 'Pi Camera V2', status: 'error', icon: 'CAM' }
    ]
  },
  {
    id: 'pi-03',
    name: 'Hive Gamma - Edge Node',
    ip: '192.168.1.106',
    status: 'offline',
    uptime: '-',
    cpu: 0,
    ram: 0,
    temp: 0,
    sensors: [
      { name: 'DHT22 climate probe', status: 'unknown', icon: 'CLM' }
    ]
  }
]

function formatNodeTime(timestamp) {
  if (!timestamp) return 'Waiting'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  return date.toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export default function Hardware() {
  const [nodes] = useState(MOCK_NODES)
  const [liveNodes, setLiveNodes] = useState([])
  const [renameDrafts, setRenameDrafts] = useState({})
  const [nodeAction, setNodeAction] = useState('')

  const getProgressClass = (val) => {
    if (val > 80) return s.high
    if (val > 50) return s.med
    return s.low
  }

  const loadLiveNodes = useCallback(async () => {
    const { data } = await api.get('/api/live/sessions')
    const sessions = data.sessions || []
    setLiveNodes(sessions)
    setRenameDrafts(current => {
      const next = { ...current }
      sessions.forEach(node => {
        if (next[node.node_id] === undefined) next[node.node_id] = node.hive_label || node.node_id
      })
      return next
    })
  }, [])

  useEffect(() => {
    loadLiveNodes().catch(console.error)
    const timer = window.setInterval(() => loadLiveNodes().catch(console.error), 2000)
    return () => window.clearInterval(timer)
  }, [loadLiveNodes])

  async function renameLiveNode(node) {
    const hiveLabel = (renameDrafts[node.node_id] || '').trim()
    if (!hiveLabel) {
      setNodeAction('Hive name is required')
      return
    }

    setNodeAction(`Renaming ${node.node_id}...`)
    try {
      await api.post('/api/live/session/rename', {
        node_id: node.node_id,
        hive_label: hiveLabel
      })
      setNodeAction('Hive name updated')
      await loadLiveNodes()
    } catch (err) {
      setNodeAction(err.response?.data?.error || 'Rename failed')
    }
  }

  return (
    <Layout>
      <BeeBackground />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.4 }}
      >
        <div className={s.header}>
          <div>
            <h1 className={s.title}>Edge node health</h1>
            <p className={s.sub}>Monitor camera nodes, climate probes, and hive-side compute readiness.</p>
          </div>
          <button className={s.btn} style={{ width: 'auto', padding: '10px 20px', background: 'var(--card)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            Provision node
          </button>
        </div>

        <section className={s.sectionBlock}>
          <div className={s.sectionHeading}>
            <div>
              <h2>Live phone nodes</h2>
              <p>Phones appear here after the camera starts on the live gate page.</p>
            </div>
            <span>{liveNodes.length} connected</span>
          </div>

          {liveNodes.length ? (
            <div className={s.hardwareGrid}>
              {liveNodes.map(node => (
                <motion.div
                  key={node.node_id}
                  className={s.nodeCard}
                  whileHover={{ y: -2 }}
                  transition={{ type: 'spring', stiffness: 300 }}
                >
                  <div className={s.nodeHeader}>
                    <div className={s.nodeTitleWrap}>
                      <div className={s.nodeIcon}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"></rect><path d="M12 18h.01"></path></svg>
                      </div>
                      <div>
                        <div className={s.nodeName}>{node.hive_label || node.node_id}</div>
                        <div className={s.nodeIp}>{node.node_id} / {node.device_label || 'Phone camera'}</div>
                      </div>
                    </div>
                    <div className={`${s.statusBadge} ${node.active ? s.statusOnline : s.statusOffline}`}>
                      <div className={s.dot} />
                      {node.active ? 'live' : 'idle'}
                    </div>
                  </div>

                  <div className={s.renameRow}>
                    <input
                      className={s.renameInput}
                      value={renameDrafts[node.node_id] || ''}
                      onChange={event => setRenameDrafts(current => ({ ...current, [node.node_id]: event.target.value }))}
                      maxLength={80}
                      aria-label={`Rename ${node.node_id}`}
                    />
                    <button className={s.saveNameBtn} onClick={() => renameLiveNode(node)}>
                      Save name
                    </button>
                  </div>

                  {node.snapshot ? (
                    <img className={s.liveSnapshot} src={node.snapshot} alt={`${node.hive_label || node.node_id} latest camera frame`} />
                  ) : (
                    <div className={s.liveSnapshotEmpty}>No preview in node list</div>
                  )}

                  <div className={s.liveMetrics}>
                    <div>
                      <span>In</span>
                      <strong>{node.count_in ?? 0}</strong>
                    </div>
                    <div>
                      <span>Out</span>
                      <strong>{node.count_out ?? 0}</strong>
                    </div>
                    <div>
                      <span>Net</span>
                      <strong>{node.net >= 0 ? '+' : ''}{node.net ?? 0}</strong>
                    </div>
                    <div>
                      <span>Detections</span>
                      <strong>{node.detections ?? 0}</strong>
                    </div>
                  </div>

                  <div className={s.sensorsList}>
                    <div className={s.sensorItem}>
                      <div className={s.sensorName}><span>CAM</span> Phone camera uplink</div>
                      <div className={`${s.sensorStatus} ${node.active ? s.ok : ''}`}>{node.active ? 'ACTIVE' : 'IDLE'}</div>
                    </div>
                    <div className={s.sensorItem}>
                      <div className={s.sensorName}><span>AI</span> {node.mode === 'hybrid' ? 'Hybrid YOLO' : 'Motion'} counting</div>
                      <div className={`${s.sensorStatus} ${s.ok}`}>{node.sensitivity || 'normal'}</div>
                    </div>
                    <div className={s.sensorItem}>
                      <div className={s.sensorName}><span>SYNC</span> Dashboard sync</div>
                      <div className={`${s.sensorStatus} ${s.ok}`}>{formatNodeTime(node.updated_at)}</div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className={s.emptyLiveNodes}>No phone node has checked in yet. Open Live Camera on a phone and press Start camera.</div>
          )}
          {nodeAction && <div className={s.nodeAction}>{nodeAction}</div>}
        </section>

        <section className={s.sectionBlock}>
          <div className={s.sectionHeading}>
            <div>
              <h2>Provisioned edge nodes</h2>
              <p>Reference hardware nodes for the field deployment plan.</p>
            </div>
          </div>
        </section>

        <div className={s.hardwareGrid}>
          {nodes.map(node => (
            <motion.div
              key={node.id}
              className={s.nodeCard}
              whileHover={{ y: -2 }}
              transition={{ type: 'spring', stiffness: 300 }}
            >
              <div className={s.nodeHeader}>
                <div className={s.nodeTitleWrap}>
                  <div className={s.nodeIcon}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="18" x2="6.01" y2="18"></line><line x1="10" y1="18" x2="10.01" y2="18"></line><path d="M12 14V6"></path><path d="M8 10h8"></path><path d="M8 6h8"></path><path d="M10 2h4"></path></svg>
                  </div>
                  <div>
                    <div className={s.nodeName}>{node.name}</div>
                    <div className={s.nodeIp}>{node.ip}</div>
                  </div>
                </div>
                <div className={`${s.statusBadge} ${node.status === 'online' ? s.statusOnline : s.statusOffline}`}>
                  <div className={s.dot} />
                  {node.status}
                </div>
              </div>

              <div className={s.metricsGrid}>
                <div className={s.metric}>
                  <div className={s.metricHeader}>
                    <span>CPU usage</span>
                    <span className={s.metricValue}>{node.cpu}%</span>
                  </div>
                  <div className={s.progressBar}>
                    <div className={`${s.progressFill} ${getProgressClass(node.cpu)}`} style={{ width: `${node.cpu}%` }} />
                  </div>
                </div>
                <div className={s.metric}>
                  <div className={s.metricHeader}>
                    <span>RAM usage</span>
                    <span className={s.metricValue}>{node.ram}%</span>
                  </div>
                  <div className={s.progressBar}>
                    <div className={`${s.progressFill} ${getProgressClass(node.ram)}`} style={{ width: `${node.ram}%` }} />
                  </div>
                </div>
                <div className={s.metric} style={{ gridColumn: '1 / -1' }}>
                  <div className={s.metricHeader} style={{ justifyContent: 'flex-start', gap: '24px' }}>
                    <span>System temp: <span className={s.metricValue} style={{ color: node.temp > 70 ? 'var(--red)' : 'var(--text)' }}>{node.temp} C</span></span>
                    <span>Uptime: <span className={s.metricValue}>{node.uptime}</span></span>
                  </div>
                </div>
              </div>

              <div className={s.sensorsList}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                  Connected peripherals
                </div>
                {node.sensors.map((sensor, idx) => (
                  <div key={idx} className={s.sensorItem}>
                    <div className={s.sensorName}>
                      <span>{sensor.icon}</span>
                      {sensor.name}
                    </div>
                    <div className={`${s.sensorStatus} ${sensor.status === 'ok' ? s.ok : sensor.status === 'error' ? s.err : ''}`}>
                      {sensor.status === 'ok' ? 'ACTIVE' : sensor.status === 'error' ? 'FAULT' : 'N/A'}
                    </div>
                  </div>
                ))}
              </div>

              <div className={s.actions}>
                <button className={s.btn}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20v-6M6 20V10M18 20V4"></path></svg>
                  Logs
                </button>
                <button className={`${s.btn} ${s.btnPrimary}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                  Reboot
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </Layout>
  )
}
