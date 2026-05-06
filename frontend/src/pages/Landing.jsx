import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import BrandMark from '../components/BrandMark'
import s from './Landing.module.css'

const features = [
  ['Identify Bee', 'Species check', 'Upload a bee image and identify stingless bee species with the AI model.'],
  ['Count Video', 'Traffic count', 'Upload a hive entrance video and count bees moving in and out.'],
  ['Live Camera', 'Phone uplink', 'Use a phone camera for live entrance monitoring and dashboard sync.'],
  ['Dashboard Trends', 'Saved records', 'Track daily, monthly, and yearly hive movement after sessions are saved.'],
  ['Farmer Reports', 'Evidence export', 'Generate simple reports from saved counts for presentation and review.'],
  ['AI Helper', 'Project assistant', 'Ask questions about your recent counts, reports, and field workflow.'],
  ['Hardware View', 'Node status', 'Review phone nodes, camera status, and field hardware readiness.'],
  ['Owner View', 'Admin tools', 'Check users, backend health, model status, and platform activity.'],
]

const metrics = [
  ['Create account', 'Username, email, password'],
  ['Default hive', 'No hive name required'],
  ['Alerts', 'Email first, Telegram later'],
]

const AUTO_ADVANCE_MS = 4200

function Chevron({ direction }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d={direction === 'next' ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'} />
    </svg>
  )
}

export default function Landing() {
  const featureRail = useRef(null)
  const programmaticScroll = useRef(false)
  const scrollReleaseTimer = useRef(null)
  const [activeFeature, setActiveFeature] = useState(0)

  function scrollFeatures(direction) {
    const next = (activeFeature + direction + features.length) % features.length
    setActiveFeature(next)
  }

  function scrollToFeature(index, behavior = 'smooth') {
    if (!featureRail.current) return
    const card = featureRail.current.children[index]
    if (!card) return
    const left = card.offsetLeft - featureRail.current.offsetLeft
    programmaticScroll.current = true
    window.clearTimeout(scrollReleaseTimer.current)
    featureRail.current.scrollTo({ left, behavior })
    scrollReleaseTimer.current = window.setTimeout(() => {
      programmaticScroll.current = false
    }, 720)
  }

  function jumpToFeature(index) {
    setActiveFeature(index)
  }

  function syncActiveFeature() {
    if (programmaticScroll.current) return
    if (!featureRail.current) return
    const cardWidth = featureRail.current.firstElementChild?.clientWidth || 1
    const next = Math.round(featureRail.current.scrollLeft / (cardWidth + 16))
    setActiveFeature(Math.min(features.length - 1, Math.max(0, next)))
  }

  useEffect(() => {
    scrollToFeature(activeFeature)
  }, [activeFeature])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveFeature(current => (current + 1) % features.length)
    }, AUTO_ADVANCE_MS)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(scrollReleaseTimer.current)
    }
  }, [])

  if (localStorage.getItem('token')) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <main className={s.page}>
      <header className={s.nav}>
        <Link to="/" className={s.brand} aria-label="HiveGate AI home">
          <BrandMark className={s.mark} />
          <span>HiveGate AI</span>
        </Link>
        <div className={s.navActions}>
          <Link to="/login" className={s.linkBtn}>Sign in</Link>
          <Link to="/register" className={s.primaryBtn}>Create account</Link>
        </div>
      </header>

      <section className={s.hero}>
        <div className={s.heroCopy}>
          <h1>Bee activity tracking, simplified.</h1>
          <p>Identify bees, count traffic, monitor live camera sessions, and save reports in one web app.</p>
          <div className={s.heroActions}>
            <Link to="/login" className={s.secondaryBtn}>Open workspace</Link>
          </div>
        </div>

        <div className={s.productPreview} aria-label="HiveGate AI workflow preview">
          <div className={s.previewHeader}>
            <span>Hive 1</span>
            <strong>Live Camera</strong>
          </div>
          <div className={s.previewFrame}>
            <div className={s.hiveLine} />
            <div className={s.beePath} />
            <div className={`${s.beeDot} ${s.beeOne}`} />
            <div className={`${s.beeDot} ${s.beeTwo}`} />
            <div className={`${s.beeDot} ${s.beeThree}`} />
          </div>
          <div className={s.previewStats}>
            <div><span>IN</span><strong>128</strong></div>
            <div><span>OUT</span><strong>96</strong></div>
            <div><span>NET</span><strong>+32</strong></div>
          </div>
        </div>
      </section>

      <section className={s.workflow}>
        <div className={s.featureIntro}>
          <div>
            <span>Slide feature tour</span>
            <h2>What users can do</h2>
            <p>Core tools for field counting, live monitoring, reporting, and owner review.</p>
          </div>
          <div className={s.carouselControls} aria-label="Feature carousel controls">
            <button type="button" onClick={() => scrollFeatures(-1)} aria-label="Previous feature">
              <Chevron direction="previous" />
            </button>
            <button type="button" onClick={() => scrollFeatures(1)} aria-label="Next feature">
              <Chevron direction="next" />
            </button>
          </div>
        </div>
        <div
          ref={featureRail}
          className={s.carouselViewport}
          onScroll={syncActiveFeature}
          aria-label="HiveGate AI features"
        >
          {features.map(([title, label, text], index) => (
            <article
              key={title}
              className={`${s.featureCard} ${index === activeFeature ? s.featureActive : ''}`}
              aria-current={index === activeFeature ? 'true' : undefined}
            >
              <div className={s.cardMeta}>
                <span>{label}</span>
                <strong>{String(index + 1).padStart(2, '0')}</strong>
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
        <div className={s.featureDots} aria-label="Feature position">
          {features.map(([title], index) => (
            <button
              key={title}
              type="button"
              className={index === activeFeature ? s.dotActive : ''}
              onClick={() => jumpToFeature(index)}
              aria-label={`Show ${title}`}
            />
          ))}
        </div>
        <div className={s.featureProgress} aria-hidden="true">
          <span key={activeFeature} />
        </div>
      </section>

      <section className={s.footerBand}>
        <div>
          <h2>Simple start, useful data.</h2>
          <p>Create an account, run a trial, save the session, and export evidence for your report.</p>
        </div>
        <div className={s.metricList}>
          {metrics.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
