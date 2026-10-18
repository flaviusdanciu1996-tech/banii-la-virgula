import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { fmtNum } from './lib/money.ts'
import { Icon as IconBy } from './icons.tsx'

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', k)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = '' }
  }, [onClose])
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-in">
          <div className="sheet-head">
            <h2>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Închide"><X size={18} /></button>
          </div>
          {children}
        </div>
      </div>
    </>
  )
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const initials = (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  let h = 0
  for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) % 360
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${h} 45% 45%)` }} title={name}>
      {initials || '?'}
    </span>
  )
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map(o => (
        <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  )
}

export function MoneyField({ id, value, onChange, suffix, big, autoFocus }: { id: string; value: string; onChange: (v: string) => void; suffix: string; big?: boolean; autoFocus?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (autoFocus) setTimeout(() => ref.current?.focus(), 80) }, [autoFocus])
  return (
    <label className={big ? 'amount big' : 'amount'} htmlFor={id}>
      <input ref={ref} id={id} inputMode="decimal" autoComplete="off" placeholder="0,00" value={value} onChange={e => onChange(e.target.value)} />
      <span>{suffix}</span>
    </label>
  )
}

/** Two-tap delete confirmation, no browser dialogs. */
export function ConfirmButton({ onConfirm, children = 'Șterge', armedText = 'Sigur?' }: { onConfirm: () => void; children?: ReactNode; armedText?: string }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t) }, [armed])
  return (
    <button type="button" className={armed ? 'danger armed' : 'danger'} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? armedText : children}
    </button>
  )
}

export function Ring({ value, color, size = 54, children }: { value: number; color: string; size?: number; children?: ReactNode }) {
  const r = (size - 6) / 2, c = 2 * Math.PI * r
  const v = useGrow(Math.max(0, Math.min(1, value)))
  return (
    <span className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth="5" />
        <circle className="ring-arc" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
      </svg>
      <span className="ring-in">{children}</span>
    </span>
  )
}

export function Bar({ value, color, over }: { value: number; color: string; over?: boolean }) {
  value = useGrow(value)
  return (
    <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: over ? 'var(--bad)' : color }} /></div>
  )
}

export function Donut({ parts, size = 120 }: { parts: { value: number; color: string; label: string }[]; size?: number }) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0)
  const r = size / 2 - 10, c = 2 * Math.PI * r
  let acc = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={parts.map(p => p.label).join(', ')}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth="16" />
      {total > 0 && parts.map((p, i) => {
        const len = (Math.max(0, p.value) / total) * c
        const el = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth="16"
          strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`} strokeDashoffset={-acc} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        acc += len
        return el
      })}
    </svg>
  )
}

/** Simple line chart; values in minor units; null = gap. */
export function LineChart({ points, height = 150, color = 'var(--accent)', target }: { points: { label: string; value: number | null }[]; height?: number; color?: string; target?: number }) {
  const W = 340, H = height, padL = 6, padR = 6, padT = 14, padB = 22
  const vals = points.map(p => p.value).filter((v): v is number => v !== null)
  if (!vals.length) return <div className="chart-empty">Încă nu sunt destule date pentru grafic.</div>
  let min = Math.min(...vals, target ?? Infinity), max = Math.max(...vals, target ?? -Infinity)
  if (min === max) { min -= 1; max += 1 }
  const span = max - min
  min -= span * 0.08; max += span * 0.08
  const x = (i: number) => padL + (i * (W - padL - padR)) / Math.max(1, points.length - 1)
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB)
  const segs: string[] = []
  let cur = ''
  points.forEach((p, i) => {
    if (p.value === null) { if (cur) segs.push(cur); cur = ''; return }
    cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`
  })
  if (cur) segs.push(cur)
  const lastIdx = points.map(p => p.value).lastIndexOf(vals[vals.length - 1])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Grafic">
      {[0.25, 0.5, 0.75].map(f => <line key={f} x1={padL} x2={W - padR} y1={padT + f * (H - padT - padB)} y2={padT + f * (H - padT - padB)} stroke="var(--line)" strokeDasharray="2 4" />)}
      {target !== undefined && <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke="var(--muted)" strokeDasharray="5 4" />}
      {segs.map((d, i) => <path key={i} d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />)}
      {points.map((p, i) => p.value !== null && <circle key={i} cx={x(i)} cy={y(p.value)} r={i === lastIdx ? 4.5 : 2.5} fill={color} />)}
      {points.map((p, i) => (i % Math.ceil(points.length / 6) === 0 || i === points.length - 1) &&
        <text key={'t' + i} x={x(i)} y={H - 6} fontSize="10" textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} fill="var(--muted)">{p.label}</text>)}
    </svg>
  )
}

/** Grouped bars: income vs expenses per period. */
export function BarsChart({ rows, height = 160 }: { rows: { label: string; a: number; b: number }[]; height?: number }) {
  const W = 340, H = height, padB = 22, padT = 8
  const max = Math.max(1, ...rows.flatMap(r => [r.a, r.b]))
  const bw = (W / Math.max(1, rows.length)) * 0.32
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Venituri și cheltuieli pe perioade">
      <line x1="0" x2={W} y1={H - padB} y2={H - padB} stroke="var(--line)" />
      {rows.map((r, i) => {
        const cx = (W / rows.length) * (i + 0.5)
        const ha = ((H - padB - padT) * r.a) / max, hb = ((H - padB - padT) * r.b) / max
        return (
          <g key={i}>
            <rect x={cx - bw - 1} y={H - padB - ha} width={bw} height={ha} rx="3" fill="var(--in)" />
            <rect x={cx + 1} y={H - padB - hb} width={bw} height={hb} rx="3" fill="var(--out-bar)" />
            <text x={cx} y={H - 6} fontSize="10" textAnchor="middle" fill="var(--muted)">{r.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** Half-circle gauge; value and target in %. */
export function Gauge({ value, target }: { value: number | null; target: number }) {
  const W = 240, H = 140, cx = 120, cy = 124, r = 96
  const scaleMax = Math.max(target * 2, 10)
  const a = (v: number) => Math.PI * (1 - Math.max(0, Math.min(1, v / scaleMax)))
  const pt = (ang: number, rr = r) => [cx + rr * Math.cos(ang), cy - rr * Math.sin(ang)]
  const arc = (from: number, to: number, color: string, key: string) => {
    const [x1, y1] = pt(a(from)), [x2, y2] = pt(a(to))
    return <path key={key} d={`M${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2}`} stroke={color} strokeWidth="18" fill="none" />
  }
  const v = value ?? 0
  const [nx, ny] = pt(a(v), r - 26)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="gauge" role="img" aria-label={`Rata de economisire ${value ?? '–'}%, ținta ${target}%`}>
      {arc(0, target * 0.5, 'var(--bad)', 'a')}
      {arc(target * 0.5, target, 'var(--warn)', 'b')}
      {arc(target, target * 1.5, 'var(--good-soft)', 'c')}
      {arc(target * 1.5, scaleMax, 'var(--good)', 'd')}
      {(() => { const [tx1, ty1] = pt(a(target), r - 14), [tx2, ty2] = pt(a(target), r + 14); return <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} stroke="var(--ink)" strokeWidth="2" /> })()}
      {value !== null && <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" />}
      <circle cx={cx} cy={cy} r="8" fill="var(--surface)" stroke="var(--ink)" strokeWidth="3" />
    </svg>
  )
}

export function Money({ v, cur = 'lei', className = '' }: { v: number; cur?: string; className?: string }) {
  return <span className={'num ' + className}>{fmtNum(v)}{cur ? ' ' + cur : ''}</span>
}

export function useToast(): [ReactNode, (m: string) => void] {
  const [msg, setMsg] = useState('')
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 2600); return () => clearTimeout(t) }, [msg])
  return [msg ? <div className="toast" role="status">{msg}</div> : null, setMsg]
}

/* ---------------- Nocturn helpers ---------------- */

/** Category icon inside a tinted circle in its group's colour. */
export function CatIcon({ icon, color, size = 38 }: { icon: string; color: string; size?: number }) {
  return (
    <span className="cat-icon" style={{ width: size, height: size, ['--c' as any]: color }}>
      <IconBy name={icon} size={Math.round(size * 0.47)} />
    </span>
  )
}

/** Number that counts up to its value on first show (respects reduced motion). */
export function useCountUp(target: number, ms = 700): number {
  const [v, setV] = useState(() => (reducedMotion() ? target : 0))
  const from = useRef(v)
  useEffect(() => {
    if (reducedMotion()) { setV(target); return }
    const start = performance.now(), a = from.current, b = target
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms)
      const e = 1 - Math.pow(1 - k, 3)
      const cur = Math.round(a + (b - a) * e)
      setV(cur); from.current = cur
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

export function CountUp({ v, cur = 'lei', className = '' }: { v: number; cur?: string; className?: string }) {
  const n = useCountUp(v)
  return <span className={'num ' + className}>{fmtNum(n)}{cur ? ' ' + cur : ''}</span>
}

export function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

/** Value that starts at 0 and moves to `v` after mount, so CSS transitions animate it. */
export function useGrow(v: number): number {
  const [x, setX] = useState(reducedMotion() ? v : 0)
  useEffect(() => { const r = requestAnimationFrame(() => setX(v)); return () => cancelAnimationFrame(r) }, [v])
  return x
}

/** Friendly illustration for empty states: an icon in a glowing blob. */
export function EmptyArt({ icon, title, text, children }: { icon: string; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="empty art">
      <div className="art-blob" aria-hidden="true">
        <span className="spark s1" /><span className="spark s2" /><span className="spark s3" />
        <IconBy name={icon} size={34} />
      </div>
      <b>{title}</b>
      <p>{text}</p>
      {children}
    </div>
  )
}

/** Full-screen confetti burst; calls onDone when finished. */
export function Confetti({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (reducedMotion()) { const t = setTimeout(onDone, 1200); return () => clearTimeout(t) }
    const c = ref.current!, ctx = c.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    c.width = innerWidth * dpr; c.height = innerHeight * dpr; ctx.scale(dpr, dpr)
    const colors = ['#FF7A66', '#6EA8FF', '#FFC24B', '#4FD1A1', '#C792FF', '#ffffff']
    const ps = Array.from({ length: 140 }, () => ({
      x: innerWidth / 2 + (Math.random() - .5) * 80, y: innerHeight * .35,
      vx: (Math.random() - .5) * 11, vy: -Math.random() * 13 - 4, r: Math.random() * 6 + 3,
      rot: Math.random() * 6, vr: (Math.random() - .5) * .3, c: colors[(Math.random() * colors.length) | 0],
    }))
    let raf = 0; const start = performance.now()
    const tick = (t: number) => {
      ctx.clearRect(0, 0, innerWidth, innerHeight)
      for (const p of ps) {
        p.vy += .32; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.rot += p.vr
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c
        ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore()
      }
      if (t - start < 2600) raf = requestAnimationFrame(tick); else onDone()
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [onDone])
  return <canvas ref={ref} className="confetti" aria-hidden="true" />
}
