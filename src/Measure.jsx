import { useEffect, useState } from 'react'

const MM_PT = 25.4 / 72 // 1 point PDF = 0,3528 mm sur le papier
const fmt = (m) => (m >= 100 ? m.toFixed(1) : m.toFixed(2)).replace('.', ',') + ' m'

// Mesure de distance : fonctionne sur l'aperçu comme sur le PDF HD (coordonnées proportionnelles à la page).
export function useMeasure(version, size, page) {
  const [on, setOn] = useState(false)
  const [mPerPt, setMPerPt] = useState(null) // mètres réels par point PDF
  const [step, setStep] = useState('choose') // choose | scale | known | measure
  const [pts, setPts] = useState([])
  const [lines, setLines] = useState([])
  const [den, setDen] = useState('100')
  const [len, setLen] = useState('')

  useEffect(() => {
    let v = 0
    try { v = Number(localStorage.getItem('echelle:' + version.id)) } catch { /* stockage indisponible */ }
    setMPerPt(v > 0 ? v : null); setStep(v > 0 ? 'measure' : 'choose'); setPts([]); setLines([]); setLen('')
  }, [version.id])

  const dist = (a, b) => Math.hypot((b.x - a.x) * size.w, (b.y - a.y) * size.h) // en points PDF
  function save(v) {
    setMPerPt(v); setStep('measure'); setPts([])
    try { localStorage.setItem('echelle:' + version.id, String(v)) } catch { /* ignoré */ }
  }

  function addPoint(x, y) {
    if (step !== 'known' && step !== 'measure') return
    const p = { x, y }
    if (pts.length !== 1) { setPts([p]); return }
    if (step === 'measure') { setLines((l) => [...l, { a: pts[0], b: p, page }]); setPts([]) }
    else setPts([pts[0], p])
  }
  function applyScale(e) {
    e.preventDefault()
    const n = Number(den)
    if (n > 0) save((MM_PT * n) / 1000)
  }
  function applyKnown(e) {
    e.preventDefault()
    const L = Number(len.replace(',', '.'))
    if (L > 0 && pts.length === 2) { save(L / dist(pts[0], pts[1])); setLen('') }
  }

  const eq = mPerPt ? Math.round((mPerPt * 1000) / MM_PT) : null
  const panel = on && (
    <div className="measurebar">
      {step === 'choose' && (
        <>
          <strong>Calibrer le plan :</strong>
          <button onClick={() => setStep('scale')}>Saisir une échelle</button>
          <button onClick={() => { setStep('known'); setPts([]) }}>Mesurer une cote connue</button>
        </>
      )}
      {step === 'scale' && (
        <form className="row" onSubmit={applyScale}>
          <span>Échelle 1 :</span>
          <input type="number" min="1" value={den} onChange={(e) => setDen(e.target.value)} />
          <button className="primary">Valider</button>
          <button type="button" onClick={() => setStep('choose')}>Retour</button>
        </form>
      )}
      {step === 'known' && (
        <>
          {pts.length < 2 ? <span>Touchez les deux extrémités d’une cote connue.</span> : (
            <form className="row" onSubmit={applyKnown}>
              <span>Longueur réelle :</span>
              <input inputMode="decimal" placeholder="mètres" value={len} onChange={(e) => setLen(e.target.value)} />
              <button className="primary">Valider</button>
            </form>
          )}
          <button onClick={() => { setPts([]); setStep('choose') }}>Retour</button>
        </>
      )}
      {step === 'measure' && (
        <>
          <span>Échelle ≈ 1:{eq} · touchez deux points pour mesurer.</span>
          <button onClick={() => { setStep('choose'); setPts([]) }}>Recalibrer</button>
          <button onClick={() => { setLines([]); setPts([]) }}>Effacer</button>
        </>
      )}
    </div>
  )

  const done = lines.filter((l) => l.page === page)
  const segs = [...done, ...(pts.length === 2 ? [{ a: pts[0], b: pts[1], tmp: true }] : [])]
  const dots = [...pts, ...done.flatMap((l) => [l.a, l.b])]
  const overlay = (
    <>
      <svg className="measuresvg" viewBox="0 0 1 1" preserveAspectRatio="none">
        {segs.map((s, i) => <line key={i} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} vectorEffect="non-scaling-stroke" />)}
      </svg>
      {dots.map((p, i) => <i key={'d' + i} className="mpt" style={{ left: p.x * 100 + '%', top: p.y * 100 + '%' }} />)}
      {mPerPt && done.map((s, i) => (
        <span key={'l' + i} className="mlabel" style={{ left: ((s.a.x + s.b.x) / 2) * 100 + '%', top: ((s.a.y + s.b.y) / 2) * 100 + '%' }}>
          {fmt(dist(s.a, s.b) * mPerPt)}
        </span>
      ))}
    </>
  )

  return { on, setOn, addPoint, panel, overlay }
}
