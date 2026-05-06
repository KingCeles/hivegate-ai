import { Link, Navigate } from 'react-router-dom'
import BrandMark from '../components/BrandMark'
import s from './Landing.module.css'

const highlights = [
  ['Identify Bee', 'Classify stingless bee photos with model-assisted species detection.'],
  ['Count Video', 'Upload hive entrance videos and save IN/OUT traffic records.'],
  ['Live Camera', 'Use a phone camera over HTTPS for live entrance monitoring.'],
  ['Reports', 'Turn saved sessions into farmer-friendly summaries and evidence exports.'],
]

const metrics = [
  ['Saved data', 'Daily, monthly, yearly trends'],
  ['AI helper', 'Answers from your recent counts'],
  ['Owner view', 'Private backend and model health'],
]

export default function Landing() {
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
          <h1>Bee monitoring for field videos, phone cameras, and saved hive reports.</h1>
          <p>
            HiveGate AI helps beekeepers identify stingless bees, count entrance traffic,
            save evidence, and review trends from one installable web app.
          </p>
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
        {highlights.map(([title, text]) => (
          <article key={title} className={s.workflowItem}>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <section className={s.footerBand}>
        <div>
          <h2>Built for a practical FYP workflow.</h2>
          <p>Run a phone trial, save the session, compare manual truth counts, and export report evidence.</p>
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
