import { useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import BrandMark from '../components/BrandMark'
import s from './Landing.module.css'

const features = [
  ['Identify Bee', 'Species check', 'Upload a bee photo and get model-assisted identification.'],
  ['Count Video', 'Traffic count', 'Upload entrance video and track bees moving in and out.'],
  ['Live Camera', 'Phone uplink', 'Use a phone camera for live entrance monitoring.'],
  ['Dashboard Trends', 'Saved data', 'Review daily, monthly, and yearly hive activity.'],
  ['Farmer Reports', 'Evidence export', 'Turn saved sessions into report-ready summaries.'],
  ['AI Helper', 'Project assistant', 'Ask questions based on your recent counts and workflow.'],
  ['Owner View', 'Admin tools', 'Check users, backend health, models, and platform activity.'],
  ['Email Alerts', 'Next phase', 'Use account email for simple activity notifications first.'],
]

const metrics = [
  ['Create account', 'Username, email, password'],
  ['Default hive', 'No hive name required'],
  ['Alerts', 'Email first, Telegram later'],
]

export default function Landing() {
  const featureRail = useRef(null)
  const [activeFeature, setActiveFeature] = useState(0)

  if (localStorage.getItem('token')) {
    return <Navigate to="/dashboard" replace />
  }

  function scrollFeatures(direction) {
    if (!featureRail.current) return
    const width = featureRail.current.clientWidth
    featureRail.current.scrollBy({ left: direction * width * 0.86, behavior: 'smooth' })
  }

  function jumpToFeature(index) {
    if (!featureRail.current) return
    const card = featureRail.current.children[index]
    if (!card) return
    setActiveFeature(index)
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' })
  }

  function syncActiveFeature() {
    if (!featureRail.current) return
    const cardWidth = featureRail.current.firstElementChild?.clientWidth || 1
    const next = Math.round(featureRail.current.scrollLeft / (cardWidth + 16))
    setActiveFeature(Math.min(features.length - 1, Math.max(0, next)))
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
          <h1>Monitor bee activity from video and live camera.</h1>
          <p>Identify bees, count entrance traffic, save evidence, and review hive trends in one web app.</p>
          <div className={s.heroActions}>
            <Link to="/register" className={s.primaryBtn}>Start monitoring</Link>
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
            <span>Feature tour</span>
            <h2>Everything in HiveGate AI</h2>
          </div>
          <div className={s.carouselControls} aria-label="Feature carousel controls">
            <button type="button" onClick={() => scrollFeatures(-1)} aria-label="Previous feature">{'<'}</button>
            <button type="button" onClick={() => scrollFeatures(1)} aria-label="Next feature">{'>'}</button>
          </div>
        </div>
        <div
          ref={featureRail}
          className={s.carouselViewport}
          onScroll={syncActiveFeature}
          aria-label="HiveGate AI features"
        >
          {features.map(([title, label, text], index) => (
            <article key={title} className={s.featureCard}>
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
