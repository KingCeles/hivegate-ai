import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import api from '../api/client'
import BeeBackground from '../components/BeeBackground'
import BrandMark from '../components/BrandMark'
import s from './Auth.module.css'

export default function Register() {
  const nav = useNavigate()
  const [form, setForm] = useState({ username: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const f = key => event => setForm({ ...form, [key]: event.target.value })

  async function submit(event) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      await api.post('/api/register', form)
      setSuccess('Account created. Redirecting...')
      setTimeout(() => nav('/login'), 1500)
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed')
    } finally {
      setLoading(false)
    }
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
          <h2>Create account.</h2>
          <p>Use email first for sign-in and future hive alerts.</p>
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
            <p className={s.tagline}>Create your account</p>
          </div>
          <form onSubmit={submit} className={s.form}>
            <div className={s.field}>
              <label>Username</label>
              <input type="text" placeholder="beekeeper123" value={form.username} onChange={f('username')} required />
            </div>
            <div className={s.field}>
              <label>Email</label>
              <input type="email" placeholder="you@email.com" value={form.email} onChange={f('email')} required />
            </div>
            <div className={s.field}>
              <label>Password</label>
              <input type="password" placeholder="8+ characters" value={form.password} onChange={f('password')} required />
            </div>
            {error && <div className={s.error}>{error}</div>}
            {success && <div className={s.success}>{success}</div>}
            <button className={s.btn} disabled={loading}>
              {loading ? 'Creating...' : 'Create account'}
            </button>
          </form>
          <p className={s.footer}>Already have an account? <Link to="/login">Sign in here</Link></p>
        </motion.div>
      </div>
    </motion.div>
  )
}
