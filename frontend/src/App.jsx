import { Component, lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { WorkspaceProvider } from './context/WorkspaceContext'

const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const Landing = lazy(() => import('./pages/Landing'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Identify = lazy(() => import('./pages/Identify'))
const Count = lazy(() => import('./pages/Count'))
const LiveCount = lazy(() => import('./pages/LiveCount'))
const FieldOperations = lazy(() => import('./pages/FieldOperations'))
const Hardware = lazy(() => import('./pages/Hardware'))
const Admin = lazy(() => import('./pages/Admin'))

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidUpdate(prevProps) {
    if (this.state.failed && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false })
    }
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <div style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--bg)',
        color: 'var(--text)',
        padding: 24
      }}>
        <div style={{
          width: 'min(420px, 100%)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--surface)',
          padding: 24,
          boxShadow: 'var(--shadow)'
        }}>
          <h1 style={{ margin: '0 0 10px', fontSize: 22 }}>Workspace could not load</h1>
          <p style={{ margin: '0 0 18px', color: 'var(--muted)', lineHeight: 1.6 }}>
            Please refresh the page or sign in again.
          </p>
          <button
            type="button"
            onClick={() => {
              const theme = localStorage.getItem('theme')
              localStorage.clear()
              if (theme) localStorage.setItem('theme', theme)
              window.location.href = '/login'
            }}
            style={{
              border: 0,
              borderRadius: 8,
              background: 'var(--amber)',
              color: '#1d1406',
              fontWeight: 900,
              padding: '11px 14px',
              cursor: 'pointer'
            }}
          >
            Return to sign in
          </button>
        </div>
      </div>
    )
  }
}

function Guard({ children }) {
  return localStorage.getItem('token') ? children : <Navigate to="/login" replace />
}

function RouteFallback() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      background: 'var(--bg)',
      color: 'var(--muted)',
      fontSize: 13,
      fontWeight: 800,
      letterSpacing: '0.08em',
      textTransform: 'uppercase'
    }}>
      Loading workspace...
    </div>
  )
}

export default function App() {
  const location = useLocation()
  
  return (
    <WorkspaceProvider>
      <AppErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<RouteFallback />}>
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/dashboard" element={<Guard><Dashboard /></Guard>} />
            <Route path="/identify" element={<Guard><Identify /></Guard>} />
            <Route path="/count" element={<Guard><Count /></Guard>} />
            <Route path="/live-count" element={<Guard><LiveCount /></Guard>} />
            <Route path="/ai-assistant" element={<Guard><FieldOperations /></Guard>} />
            <Route path="/field-operations" element={<Navigate to="/ai-assistant" replace />} />
            <Route path="/hardware" element={<Guard><Hardware /></Guard>} />
            <Route path="/admin" element={<Guard><Admin /></Guard>} />
          </Routes>
        </Suspense>
      </AppErrorBoundary>
    </WorkspaceProvider>
  )
}
