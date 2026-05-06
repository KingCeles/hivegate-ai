import styles from './BrandMark.module.css'

export default function BrandMark({ className = '', label = 'HiveGate AI Logo' }) {
  return (
    <svg
      className={`${styles.mark} ${className}`.trim()}
      viewBox="0 0 64 64"
      role="img"
      aria-label={label}
    >
      <defs>
        <linearGradient id="hivegateMarkGold" x1="14" y1="8" x2="50" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffd36a" />
          <stop offset="1" stopColor="#f4a62a" />
        </linearGradient>
      </defs>
      <path
        className={styles.hive}
        d="M32 5 54 17.7v28.6L32 59 10 46.3V17.7L32 5Z"
      />
      <path className={styles.gate} d="M22 47V28c0-6 4-10 10-10s10 4 10 10v19" />
      <path className={styles.gateBase} d="M18 47h28" />
      <path className={styles.flightPath} d="M18 23c7-8 20-8 28 0" />
      <circle className={styles.node} cx="18" cy="23" r="2.4" />
      <circle className={styles.node} cx="46" cy="23" r="2.4" />
      <path className={styles.beeBody} d="M35.5 34.5c2.7 0 4.9 1.7 4.9 3.8s-2.2 3.8-4.9 3.8-4.9-1.7-4.9-3.8 2.2-3.8 4.9-3.8Z" />
      <path className={styles.beeWing} d="M33.2 34.8c-2.2-2.6-5.3-1.8-5.5.7-.2 2.2 2.7 2.8 5.5-.7Z" />
      <path className={styles.beeWing} d="M37.9 34.8c2.2-2.6 5.3-1.8 5.5.7.2 2.2-2.7 2.8-5.5-.7Z" />
      <path className={styles.beeStripe} d="M34.2 34.9v6.8" />
      <path className={styles.beeStripe} d="M37.2 35.1v6.4" />
    </svg>
  )
}
