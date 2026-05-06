import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import api from '../api/client'
import BeeBackground from '../components/BeeBackground'
import BrandMark from '../components/BrandMark'
import s from './Auth.module.css'

export default function Login() {
  const nav = useNavigate()
  const [form, setForm] = useState({ email:'', password:'' })
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const { data } = await api.post('/api/login', form)
      localStorage.setItem('token',     data.token)
      localStorage.setItem('username',  data.username)
      localStorage.setItem('hive_name', data.hive_name)
      localStorage.setItem('is_admin', data.is_admin ? 'true' : 'false')
      nav('/dashboard')
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed')
    } finally { setLoading(false) }
  }

  return (
    <motion.div 
      className={s.page}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <BeeBackground />
      <div className={s.splitLeft}>
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <h2>Smart Hive<br/>Management.</h2>
          <p>Monitor your apiary with real-time AI computer vision and comprehensive IoT environmental data.</p>
        </motion.div>
      </div>

      <div className={s.splitRight}>
        <motion.div 
          className={s.card}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <div className={s.logoWrap}>
            <div className={s.hex}>
              <BrandMark className={s.logoImgAuth} />
            </div>
            <h1 className={s.brand}>HiveGate AI</h1>
            <p className={s.tagline}>Welcome back, Beekeeper</p>
          </div>
          <form onSubmit={submit} className={s.form}>
            <div className={s.field}>
              <label>Email</label>
              <input type="email" placeholder="you@email.com"
                value={form.email} onChange={e=>setForm({...form,email:e.target.value})} required />
            </div>
            <div className={s.field}>
              <label>Password</label>
              <input type="password" placeholder="••••••••"
                value={form.password} onChange={e=>setForm({...form,password:e.target.value})} required />
            </div>
            {error && <div className={s.error}>{error}</div>}
            <button className={s.btn} disabled={loading}>
              {loading ? 'Authenticating…' : 'Sign in'}
            </button>
          </form>
          <p className={s.footer}>No account? <Link to="/register">Create one here</Link></p>
        </motion.div>
      </div>
    </motion.div>
  )
}
