import { lazy, Suspense } from 'react'
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
    </WorkspaceProvider>
  )
}
