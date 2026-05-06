import { useState, useRef } from 'react'
import Layout from '../components/Layout'
import api from '../api/client'
import s from './Identify.module.css'

const SPECIES_INFO = {
  'H. itama': { full: 'Heterotrigona itama', color: '#c88216', desc: 'Small stingless bee common in Southeast Asia, known for mild medicinal honey.' },
  'G. thoracica': { full: 'Geniotrigona thoracica', color: '#247a52', desc: 'Medium stingless bee with distinctive thorax markings, often found in lowland forests.' },
  'T. binghami': { full: 'Tetrigona binghami', color: '#6054b8', desc: 'Dark-coloured stingless bee that builds resin nests in tree cavities.' },
}

export default function Identify() {
  const [preview, setPreview] = useState(null)
  const [file, setFile] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef()

  function handleFile(f) {
    if (!f || !f.type.startsWith('image/')) {
      setError('Please upload an image file, such as JPG or PNG.')
      return
    }
    setFile(f)
    setResult(null)
    setError('')
    const reader = new FileReader()
    reader.onload = e => setPreview(e.target.result)
    reader.readAsDataURL(f)
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  async function identify() {
    if (!file) return
    setLoading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('image', file)
      const { data } = await api.post('/api/identify', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      setResult(data)
    } catch (err) {
      setError(err.response?.data?.error || 'Identification failed')
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setPreview(null)
    setFile(null)
    setResult(null)
    setError('')
  }

  return (
    <Layout>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Species identification</h1>
          <p className={s.sub}>Upload a field photo for model-assisted stingless bee classification.</p>
        </div>
      </div>

      <div className={`${s.content} fade-in`}>
        <div className={s.left}>
          {!preview ? (
            <div
              className={`${s.dropzone} ${dragging ? s.dragOver : ''}`}
              onClick={() => inputRef.current.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <div className={s.dropIcon}>IMG</div>
              <div className={s.dropText}>Click or drag a bee image here</div>
              <div className={s.dropSub}>JPG and PNG supported</div>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => handleFile(e.target.files[0])}
              />
            </div>
          ) : (
            <div className={s.previewWrap}>
              <img
                src={result?.annotated_image
                  ? `data:image/jpeg;base64,${result.annotated_image}`
                  : preview}
                alt="Bee sample"
                className={s.previewImg}
              />
              <div className={s.previewActions}>
                <button className={s.btnReset} onClick={reset}>Upload new image</button>
                {!result && (
                  <button className={s.btnIdentify} onClick={identify} disabled={loading}>
                    {loading ? <><span className="spinning">...</span> Identifying...</> : 'Identify species'}
                  </button>
                )}
              </div>
            </div>
          )}

          {error && <div className={s.error}>{error}</div>}
        </div>

        <div className={s.right}>
          {!result && !loading && (
            <div className={s.placeholder}>
              <div className={s.placeholderIcon}>SCAN</div>
              <p>Upload a clear bee image and run species identification.</p>
            </div>
          )}

          {loading && (
            <div className={s.placeholder}>
              <div className="spinning" style={{ fontSize: 32 }}>...</div>
              <p style={{ marginTop: 12 }}>Running identification model...</p>
            </div>
          )}

          {result && !loading && (
            <div className={s.results}>
              <div className={s.resultHeader}>
                {result.total_found === 0
                  ? 'No bees detected in this image'
                  : `${result.total_found} bee${result.total_found > 1 ? 's' : ''} detected`}
              </div>

              {result.detections.map((det, i) => {
                const info = SPECIES_INFO[det.short] || {}
                return (
                  <div key={i} className={s.detCard} style={{ '--sp-color': det.color || info.color || '#888' }}>
                    <div className={s.detTop}>
                      <div>
                        <div className={s.detName}>{det.species}</div>
                        <div className={s.detShort}>{det.short}</div>
                      </div>
                      <div className={s.confBadge}>{det.confidence}%</div>
                    </div>

                    <div className={s.confBar}>
                      <div className={s.confFill} style={{ width: `${det.confidence}%` }} />
                    </div>

                    <p className={s.detDesc}>{info.desc || det.description}</p>
                  </div>
                )
              })}

              {result.total_found === 0 && (
                <div className={s.noDetect}>
                  Try a clearer photo with the bee larger in the frame and separated from the background.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={s.refSection}>
        <div className={s.refTitle}>Supported species</div>
        <div className={s.refGrid}>
          {Object.entries(SPECIES_INFO).map(([short, info]) => (
            <div key={short} className={s.refCard} style={{ '--sp-color': info.color }}>
              <div className={s.refName}>{info.full}</div>
              <div className={s.refShort}>{short}</div>
              <p className={s.refDesc}>{info.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  )
}
