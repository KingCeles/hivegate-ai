import { useCallback, useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
import BeeBackground from '../components/BeeBackground'
import api from '../api/client'
import s from './Admin.module.css'
import { motion } from 'framer-motion'

function formatPercent(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : 'Unavailable'
}

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString() : '0'
}

function formatDate(value) {
  if (!value) return 'No activity'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unavailable'
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function StatusRow({ label, value, tone }) {
  return (
    <div className={s.row}>
      <span>{label}</span>
      <strong className={tone ? s[tone] : ''}>{value}</strong>
    </div>
  )
}

function MetricCard({ label, value, detail, tone }) {
  return (
    <div className={`${s.summaryCard} ${tone ? s[tone] : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <p>{detail}</p>}
    </div>
  )
}

export default function Admin() {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const [accessDenied, setAccessDenied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.get('/api/admin/status')
      setStatus(res.data)
      setError(null)
      setAccessDenied(false)
      setLastUpdated(new Date())
    } catch (err) {
      if (err.response?.status === 403) {
        setAccessDenied(true)
        setStatus(null)
        setError('')
        return
      }
      setError(err.response?.data?.error || err.message || 'Failed to fetch status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 10000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const updatedText = useMemo(() => {
    if (!lastUpdated) return 'Waiting for first check'
    return `Last checked ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
  }, [lastUpdated])

  const activity = status?.usage?.daily_activity || []
  const maxActivity = Math.max(1, ...activity.map(day => Number(day.in || 0) + Number(day.out || 0)))
  const serviceTone = status?.status === 'online' ? 'ok' : 'warn'

  function exportSnapshot() {
    if (!status) return
    const blob = new Blob([JSON.stringify(status, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hivegate-owner-snapshot-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Layout>
      <BeeBackground />
      <div className={s.container}>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={s.header}
        >
          <div>
            <div className={s.kicker}>Owner dashboard</div>
            <h1>Admin Control Room</h1>
            <p>Private backend data, user activity, model health, and exportable platform snapshots.</p>
          </div>
          <div className={s.headerActions}>
            <div className={s.refreshMeta}>{updatedText}</div>
            <button className={s.secondaryBtn} onClick={exportSnapshot} disabled={!status}>Export JSON</button>
            <button className={s.refreshBtn} onClick={fetchStatus} disabled={loading}>
              {loading ? 'Checking...' : 'Refresh'}
            </button>
          </div>
        </motion.div>

        {error && <div className={s.error}>Error: {error}</div>}

        {accessDenied && (
          <div className={s.accessDenied}>
            <div className={s.accessIcon}>!</div>
            <h2>Creator access required</h2>
            <p>This page is private to the website owner. Sign in with the creator account or set ADMIN_EMAIL on the backend.</p>
          </div>
        )}

        {status ? (
          <>
            <div className={s.summaryGrid}>
              <MetricCard label="Service state" value={String(status.status || 'unknown').toUpperCase()} detail="Main Flask API" tone={serviceTone} />
              <MetricCard label="Users" value={formatNumber(status.database?.total_users)} detail={`${formatNumber(status.database?.active_users_7d)} active in 7 days`} />
              <MetricCard label="Saved records" value={formatNumber(status.database?.total_logs)} detail={`${formatNumber(status.database?.total_reports)} farmer reports`} />
              <MetricCard label="Lifetime traffic" value={formatNumber((status.database?.total_in || 0) + (status.database?.total_out || 0))} detail={`${formatNumber(status.database?.total_in)} in / ${formatNumber(status.database?.total_out)} out`} />
            </div>

            <div className={s.ownerGrid}>
              <section className={`${s.card} ${s.wideCard}`}>
                <div className={s.cardHeader}>
                  <div>
                    <div className={s.cardTitle}>Platform Activity</div>
                    <p className={s.helpText}>Last 14 days of saved hive traffic records.</p>
                  </div>
                  <div className={s.statusBadge}>
                    <span className={s.pulse}></span>
                    {formatNumber(status.usage?.videos_processed)} processed
                  </div>
                </div>
                <div className={s.activityChart}>
                  {activity.length ? activity.map(day => {
                    const total = Number(day.in || 0) + Number(day.out || 0)
                    return (
                      <div key={day.date} className={s.activityDay}>
                        <div className={s.activityBars}>
                          <span className={s.inBar} style={{ height: `${Math.max(4, (Number(day.in || 0) / maxActivity) * 100)}%` }} />
                          <span className={s.outBar} style={{ height: `${Math.max(4, (Number(day.out || 0) / maxActivity) * 100)}%` }} />
                        </div>
                        <strong>{total}</strong>
                        <span>{day.date.slice(5)}</span>
                      </div>
                    )
                  }) : <div className={s.emptyState}>No saved activity yet.</div>}
                </div>
              </section>

              <section className={s.card}>
                <div className={s.cardTitle}>System Resources</div>
                <StatusRow label="CPU usage" value={formatPercent(status.system?.cpu_percent)} />
                <StatusRow label="RAM usage" value={`${formatPercent(status.system?.memory_percent)} (${formatNumber(status.system?.memory_used_mb)} MB)`} />
                <StatusRow label="Disk usage" value={formatPercent(status.system?.disk_percent)} />
                <StatusRow label="Database size" value={`${formatNumber(status.database?.size_mb)} MB`} />
              </section>

              <section className={s.card}>
                <div className={s.cardTitle}>Models + Services</div>
                <StatusRow label="Count model" value={status.models?.count_model || 'Unavailable'} />
                <StatusRow label="ID model" value={status.models?.id_model || 'Unavailable'} />
                <StatusRow label="Dataset images" value={formatNumber(status.models?.dataset_images)} />
                <StatusRow label="Live sessions" value={`${formatNumber(status.usage?.active_live_sessions)} active / ${formatNumber(status.usage?.live_sessions)} total`} tone={status.usage?.active_live_sessions ? 'okText' : ''} />
              </section>

              <section className={`${s.card} ${s.wideCard}`}>
                <div className={s.cardHeader}>
                  <div className={s.cardTitle}>Users</div>
                  <span className={s.tableHint}>{formatNumber(status.users?.length)} recent accounts</span>
                </div>
                <div className={s.tableWrap}>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Hive</th>
                        <th>Logs</th>
                        <th>Reports</th>
                        <th>Traffic</th>
                        <th>Latest</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(status.users || []).map(user => (
                        <tr key={user.id}>
                          <td>
                            <strong>{user.username}</strong>
                            <span>{user.email}{user.is_admin ? ' / owner' : ''}</span>
                          </td>
                          <td>{user.hive_name || 'My Hive'}</td>
                          <td>{formatNumber(user.log_count)}</td>
                          <td>{formatNumber(user.report_count)}</td>
                          <td>{formatNumber((user.total_in || 0) + (user.total_out || 0))}</td>
                          <td>{formatDate(user.latest_count_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className={s.card}>
                <div className={s.cardTitle}>Recent Count Logs</div>
                <div className={s.list}>
                  {(status.recent_count_logs || []).map(log => (
                    <div key={log.id} className={s.listItem}>
                      <div>
                        <strong>{log.hive_name || log.username}</strong>
                        <span>{log.username} / {formatDate(log.timestamp)}</span>
                      </div>
                      <b>{formatNumber(log.count_in)} in / {formatNumber(log.count_out)} out</b>
                    </div>
                  ))}
                  {!(status.recent_count_logs || []).length && <div className={s.emptyState}>No count logs yet.</div>}
                </div>
              </section>

              <section className={s.card}>
                <div className={s.cardTitle}>Recent Reports</div>
                <div className={s.list}>
                  {(status.recent_reports || []).map(report => (
                    <div key={report.id} className={s.listItem}>
                      <div>
                        <strong>{report.title}</strong>
                        <span>{report.username} / {formatDate(report.created_at)}</span>
                      </div>
                      <b>{report.status_label || 'Report'}</b>
                    </div>
                  ))}
                  {!(status.recent_reports || []).length && <div className={s.emptyState}>No reports generated yet.</div>}
                </div>
              </section>

              <section className={`${s.card} ${s.wideCard}`}>
                <div className={s.cardTitle}>Recent Backend Errors</div>
                {(status.usage?.recent_errors || []).length ? (
                  <div className={s.errorList}>
                    {status.usage.recent_errors.map((line, index) => <code key={`${line}-${index}`}>{line}</code>)}
                  </div>
                ) : (
                  <div className={s.emptyState}>No recent backend errors found in local logs.</div>
                )}
              </section>
            </div>
          </>
        ) : (
          !error && !accessDenied && <div className={s.loading}>Loading owner dashboard...</div>
        )}
      </div>
    </Layout>
  )
}
