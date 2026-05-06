import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import styles from './Layout.module.css'
import BrandMark from './BrandMark'
import { useWorkspace } from '../context/WorkspaceContext'

const Icons = {
  Dashboard: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><path d="M4 20h16"></path><path d="M7 16v4"></path><path d="M12 12v8"></path><path d="M17 14v6"></path></svg>
  ),
  Identify: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="10" r="6"></circle><path d="m15 15 6 6"></path><path d="M8 10h4"></path><path d="M10 8v4"></path><path d="M7 6.5 5.5 5"></path><path d="M13 6.5 14.5 5"></path></svg>
  ),
  Count: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m10 9 5 3-5 3V9z"></path><path d="M6 2v3"></path><path d="M18 2v3"></path><path d="M7 22h10"></path></svg>
  ),
  LiveCount: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z"></path><rect x="1" y="5" width="15" height="14" rx="2"></rect><circle cx="8.5" cy="12" r="2.5"></circle></svg>
  ),
  FieldOperations: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path><path d="M9 10h6"></path><path d="M9 14h3"></path><path d="M18 2v3"></path><path d="M20.5 4.5H17"></path></svg>
  ),
  Hardware: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="7" width="10" height="10" rx="2"></rect><path d="M12 3v4"></path><path d="M12 17v4"></path><path d="M3 12h4"></path><path d="M17 12h4"></path><circle cx="12" cy="12" r="2"></circle></svg>
  ),
  Admin: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="M9.5 12.5 11 14l3.5-4"></path></svg>
  ),
  Logout: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
  ),
  Sun: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
  ),
  Moon: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
  ),
  ChevronRight: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
  ),
  SidebarToggle: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M9 4v16"></path><path d="m15 9-3 3 3 3"></path></svg>
  )
}

const NAV = [
  { path: '/dashboard', label: 'Dashboard', icon: Icons.Dashboard },
  { path: '/identify',  label: 'Identify Bee', icon: Icons.Identify },
  { path: '/count',     label: 'Count Video', icon: Icons.Count },
  { path: '/live-count', label: 'Live Camera', icon: Icons.LiveCount },
  { path: '/ai-assistant', label: 'AI Helper', icon: Icons.FieldOperations },
  { path: '/hardware',  label: 'Devices', icon: Icons.Hardware },
  { path: '/admin',  label: 'Admin', icon: Icons.Admin, adminOnly: true },
]

const ROUTE_PRELOADS = {
  '/dashboard': () => import('../pages/Dashboard'),
  '/identify': () => import('../pages/Identify'),
  '/count': () => import('../pages/Count'),
  '/live-count': () => import('../pages/LiveCount'),
  '/ai-assistant': () => import('../pages/FieldOperations'),
  '/hardware': () => import('../pages/Hardware'),
  '/admin': () => import('../pages/Admin')
}

function preloadRoute(path) {
  ROUTE_PRELOADS[path]?.()
}

export default function Layout({ children }) {
  const nav      = useNavigate()
  const location = useLocation()
  const { countSession, countSetters, assistant } = useWorkspace()
  const user     = localStorage.getItem('username') || 'Beekeeper'
  const hive     = localStorage.getItem('hive_name') || 'My Hive'
  const [isAdmin, setIsAdmin] = useState(localStorage.getItem('is_admin') === 'true')
  
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(localStorage.getItem('sidebar_collapsed') === 'true')

  useEffect(() => {
    let cancelled = false
    const token = localStorage.getItem('token')
    if (!token) return undefined

    import('../api/client').then(({ default: api }) => {
      api.get('/api/me')
        .then(({ data }) => {
          if (cancelled) return
          const nextIsAdmin = data.is_admin ? 'true' : 'false'
          localStorage.setItem('is_admin', nextIsAdmin)
          setIsAdmin(data.is_admin === true)
        })
        .catch(() => {
          if (!cancelled) setIsAdmin(localStorage.getItem('is_admin') === 'true')
        })
    })

    return () => {
      cancelled = true
    }
  }, [])

  function toggleTheme() {
    const nextTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(nextTheme)
    localStorage.setItem('theme', nextTheme)
    document.documentElement.setAttribute('data-theme', nextTheme)
  }

  function toggleSidebar() {
    setSidebarCollapsed(current => {
      const next = !current
      localStorage.setItem('sidebar_collapsed', next ? 'true' : 'false')
      return next
    })
  }

  function logout() {
    const theme = localStorage.getItem('theme')
    countSetters.resetCountSession()
    assistant.resetAssistantSession()
    localStorage.clear()
    if (theme) localStorage.setItem('theme', theme)
    nav('/login')
  }

  const visibleNav = NAV.filter(n => !n.adminOnly || isAdmin)
  const activeNav = NAV.find(n => n.path === location.pathname) || { label: 'Page' }
  const sidebarToggleLabel = sidebarCollapsed ? 'Open sidebar' : 'Close sidebar'
  const themeToggleLabel = theme === 'light' ? 'Dark mode' : 'Light mode'
  const trafficActive = countSession.uploading || countSession.step === 2
  const trafficDone = countSession.step === 3 && countSession.result
  const showTrafficStatus = trafficActive || trafficDone
  const trafficLabel = trafficDone
    ? 'Video result ready'
    : countSession.progressLabel || (countSession.uploading ? 'Preparing video' : 'Processing video')

  return (
    <div className={`${styles.layout} ${sidebarCollapsed ? styles.layoutCollapsed : ''}`}>
      <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.sidebarCollapsed : ''}`}>
        <div className={styles.top}>
          <div className={styles.brandRow}>
            <button type="button" className={styles.logo} onClick={() => nav('/dashboard')} aria-label="Go to Dashboard">
              <BrandMark className={styles.logoImg} />
              <div className={styles.logoText}>
                <div className={styles.logoName}>HiveGate AI</div>
                <div className={styles.logoHive}>{hive}</div>
              </div>
            </button>
            <button
              type="button"
              className={`${styles.sidebarToggle} ${styles.tooltipHost}`}
              onClick={toggleSidebar}
              aria-label={sidebarToggleLabel}
            >
              <Icons.SidebarToggle />
              <span className={styles.tooltipLabel} role="tooltip">{sidebarToggleLabel}</span>
            </button>
          </div>

          <div className={styles.navLabel}>Field operations</div>
          <nav className={styles.nav}>
            {visibleNav.map(n => (
              <button
                key={n.path}
                className={`${styles.navBtn} ${location.pathname === n.path ? styles.active : ''}`}
                onMouseEnter={() => preloadRoute(n.path)}
                onFocus={() => preloadRoute(n.path)}
                onTouchStart={() => preloadRoute(n.path)}
                onClick={() => nav(n.path)}
                aria-label={n.label}
              >
                <n.icon />
                <span>{n.label}</span>
                <span className={styles.tooltipLabel} role="tooltip">{n.label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className={styles.bottom}>
          <div className={styles.userRow}>
            <div className={styles.avatar}>{user.slice(0,1).toUpperCase()}</div>
            <div className={styles.userMeta}>
              <div className={styles.userName}>{user}</div>
              <button className={`${styles.logout} ${styles.tooltipHost}`} onClick={logout} aria-label="Sign out">
                <Icons.Logout />
                <span>Sign out</span>
                <span className={styles.tooltipLabel} role="tooltip">Sign out</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div className={styles.mainArea}>
        <header className={styles.topBar}>
          <div className={styles.breadcrumbs}>
            <span>HiveGate AI</span>
            <Icons.ChevronRight />
            <span className={styles.bcItem}>{activeNav.label}</span>
          </div>

          <div className={styles.topActions}>
            {showTrafficStatus && (
              <button
                type="button"
                className={`${styles.trafficStatus} ${trafficDone ? styles.trafficStatusDone : ''}`}
                onClick={() => nav('/count')}
              >
                <span className={styles.trafficDot} />
                <span>{trafficLabel}</span>
              </button>
            )}
            <div className={styles.status}>
              <div className={styles.statusDot} />
              Edge Sync Online
            </div>
            <button
              type="button"
              className={`${styles.themeToggleMini} ${styles.tooltipHost}`}
              onClick={toggleTheme}
              aria-label={themeToggleLabel}
            >
              {theme === 'light' ? <Icons.Sun /> : <Icons.Moon />}
              <span className={`${styles.tooltipLabel} ${styles.tooltipBelow}`} role="tooltip">{themeToggleLabel}</span>
            </button>
          </div>
        </header>

        <main className={styles.main}>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  )
}
