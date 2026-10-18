import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Check, ChevronRight, Download, ImagePlus, Images, Plus, X } from 'lucide-react'
import { useStore } from '../store.tsx'
import { supabase } from '../db.ts'
import { Icon } from '../icons.tsx'
import { Seg, Sheet } from '../ui.tsx'
import { fmt, pct } from '../lib/money.ts'
import { todayIso } from '../lib/period.ts'
import { monthlyNeeded } from '../lib/schedule.ts'
import { compress } from './Receipt.tsx'
import { DREAM_CATS, dreamCat, type Goal } from '../lib/types.ts'
import type { Nav } from '../App.tsx'

/* ---------- Photos ---------- */

/* Signed links to private photos, kept for ~50 minutes so scrolling doesn't re-ask the server. */
const urlCache = new Map<string, { url: string; until: number }>()
const isLocal = (p: string) => p.startsWith('data:') || p.startsWith('blob:')
export function useDreamUrl(path?: string | null): string | null {
  const cached = path ? urlCache.get(path) : undefined
  const [url, setUrl] = useState<string | null>(path && isLocal(path) ? path : cached && cached.until > Date.now() ? cached.url : null)
  useEffect(() => {
    if (!path) { setUrl(null); return }
    if (isLocal(path)) { setUrl(path); return }
    const c = urlCache.get(path)
    if (c && c.until > Date.now()) { setUrl(c.url); return }
    let live = true
    supabase?.storage.from('dreams').createSignedUrl(path, 3600).then(({ data }) => {
      if (!live || !data) return
      urlCache.set(path, { url: data.signedUrl, until: Date.now() + 50 * 60_000 })
      setUrl(data.signedUrl)
    })
    return () => { live = false }
  }, [path])
  return url
}

const dreamTitle = (g: Goal) => g.name || dreamCat(g.category).name

/** The dream's photo, or a colourful placeholder with its icon. */
export function DreamImage({ g, className = '' }: { g: Goal; className?: string }) {
  const url = useDreamUrl(g.photo_path)
  const c = dreamCat(g.category)
  return url
    ? <img className={'dream-img ' + className} src={url} alt={dreamTitle(g)} loading="lazy" />
    : <span className={'dream-img dream-ph ' + className} style={{ background: `linear-gradient(135deg, ${c.color}, var(--accent))` }} aria-hidden="true"><Icon name={g.photo_path ? c.icon : g.icon || c.icon} size={30} /></span>
}

export async function saveDreamPhoto(householdId: string, goalId: string, blob: Blob, old?: string | null): Promise<string> {
  if (!supabase) return URL.createObjectURL(blob)
  const path = `${householdId}/${goalId}-${Date.now()}.jpg`
  const { error } = await supabase.storage.from('dreams').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw new Error('Poza nu s-a putut încărca. Încearcă din nou.')
  if (old && !isLocal(old)) supabase.storage.from('dreams').remove([old]).catch(() => {})
  return path
}
export async function removeDreamPhoto(old?: string | null) {
  if (supabase && old && !isLocal(old)) await supabase.storage.from('dreams').remove([old]).catch(() => {})
}

/* ---------- Shared bits ---------- */

const isFunded = (g: Goal) => g.target > 0 && g.saved >= g.target
const isDone = (g: Goal) => !!g.done_on
const order = (a: Goal, b: Goal) =>
  Number(isDone(a)) - Number(isDone(b)) ||
  DREAM_CATS.findIndex(c => c.id === (a.category || 'altele')) - DREAM_CATS.findIndex(c => c.id === (b.category || 'altele'))

function useToggleDone(celebrate: (m: string) => void, notify: (m: string) => void) {
  const st = useStore()
  return async (g: Goal) => {
    try {
      if (g.done_on) { await st.saveGoal({ id: g.id, done_on: null }); notify('Bifa scoasă') }
      else { await st.saveGoal({ id: g.id, done_on: todayIso() }); celebrate(`Realizat: ${dreamTitle(g)}! 🎉`) }
    } catch { notify('Nu s-a putut salva. Încearcă din nou.') }
  }
}

function TickBox({ g, onToggle }: { g: Goal; onToggle: () => void }) {
  return (
    <span role="checkbox" aria-checked={isDone(g)} aria-label={isDone(g) ? `Scoate bifa: ${dreamTitle(g)}` : `Bifează ca realizat: ${dreamTitle(g)}`} tabIndex={0}
      className={'tick' + (isDone(g) ? ' on' : '')}
      onClick={e => { e.stopPropagation(); onToggle() }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onToggle() } }}>
      {isDone(g) && <Check size={14} strokeWidth={3.5} />}
    </span>
  )
}

/* ---------- Home strip ---------- */

export function DreamStrip({ openGoal, nav }: { openGoal: (g?: Goal, add?: boolean) => void; nav: Nav }) {
  const st = useStore()
  const dreams = st.goals.filter(g => !g.archived).sort(order)
  const done = dreams.filter(isDone).length
  return (
    <section className="dreams-home">
      <div className="sec-head">
        <h2>Visurile mele{done ? <span className="muted small"> · {done} realizate</span> : null}</h2>
        {dreams.length > 0 && <button type="button" className="link" onClick={() => nav('visuri')}>Colajul <ChevronRight size={15} /></button>}
      </div>
      <div className="dream-strip">
        {dreams.slice(0, 12).map(g => {
          const p = g.target ? Math.min(100, pct(g.saved, g.target)) : null
          return (
            <button key={g.id} type="button" className={'dream-tile' + (isDone(g) ? ' done' : '')} onClick={() => nav('visuri')}>
              <DreamImage g={g} />
              <span className="dream-shade" />
              {isDone(g) && <span className="tick on static"><Check size={14} strokeWidth={3.5} /></span>}
              <span className="dream-cap">
                <b>{dreamTitle(g)}</b>
                {isDone(g) ? <span className="small">Realizat ✓</span> : p !== null && <>
                  <span className="dream-bar"><i style={{ width: p + '%' }} /></span>
                  <span className="small num">{isFunded(g) ? 'Bani strânși! 🎉' : `${p}% · mai ai ${fmt(g.target - g.saved).replace(',00', '')}`}</span>
                </>}
              </span>
            </button>
          )
        })}
        <button type="button" className="dream-tile dream-new" onClick={() => openGoal()}>
          <ImagePlus size={26} />
          <b>{dreams.length ? 'Vis nou' : 'Adaugă primul vis'}</b>
          <span className="small">cabana, mașina, o călătorie</span>
        </button>
      </div>
    </section>
  )
}

/* ---------- Full board ---------- */

type View = 'colaj' | 'carduri'
const VIEW_KEY = 'banii-dream-view'

export function DreamsScreen({ openGoal, notify, celebrate }: { openGoal: (g?: Goal, add?: boolean) => void; notify: (m: string) => void; celebrate: (m: string) => void }) {
  const st = useStore()
  const [view, setViewState] = useState<View>(() => { try { return (localStorage.getItem(VIEW_KEY) as View) || 'colaj' } catch { return 'colaj' } })
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* fine */ } }
  const [cat, setCat] = useState('')
  const [bulk, setBulk] = useState(false)
  const [exporting, setExporting] = useState(false)
  const toggle = useToggleDone(celebrate, notify)
  const all = useMemo(() => st.goals.filter(g => !g.archived).sort(order), [st.goals])
  const dreams = all.filter(g => !cat || (cat === 'done' ? isDone(g) : (g.category || 'altele') === cat))
  const usedCats = DREAM_CATS.filter(c => all.some(g => (g.category || 'altele') === c.id))
  const done = all.filter(isDone).length

  async function exportImage() {
    setExporting(true)
    try {
      const file = await renderWallpaper(all)
      const nav: any = navigator
      if (nav.canShare?.({ files: [file] })) await nav.share({ files: [file], title: 'Visurile mele' })
      else {
        const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      }
      notify('Imaginea e gata. Pune-o ca fundal din Galerie.')
    } catch (e: any) { if (e?.name !== 'AbortError') notify('Nu am putut face imaginea. Încearcă din nou.') }
    finally { setExporting(false) }
  }

  return (
    <div className="screen">
      <div className="dream-top">
        <p className="muted">Pentru ce muncești. {done ? <b className="good">{done} din {all.length} realizate.</b> : 'Bifează ce realizezi.'}</p>
        <Seg label="Cum le vezi" value={view} onChange={setView} options={[{ id: 'colaj', label: 'Colaj' }, { id: 'carduri', label: 'Carduri cu bani' }]} />
        {all.length > 0 && (
          <div className="chips dream-filter">
            <button type="button" className="chip" aria-pressed={!cat} onClick={() => setCat('')}>Toate</button>
            {usedCats.map(c => <button key={c.id} type="button" className="chip" aria-pressed={cat === c.id} onClick={() => setCat(cat === c.id ? '' : c.id)}><i className="dot" style={{ background: c.color }} />{c.name}</button>)}
            {done > 0 && <button type="button" className="chip" aria-pressed={cat === 'done'} onClick={() => setCat(cat === 'done' ? '' : 'done')}>✓ Realizate</button>}
          </div>
        )}
      </div>

      {all.length === 0 ? (
        <div className="dream-empty card">
          <Images size={30} />
          <b>Fă-ți colajul de vise</b>
          <p className="muted">Familia, casa, mașina, locurile unde vrei să ajungi, oamenii pe care vrei să-i cunoști. Alege mai multe poze deodată din galerie.</p>
        </div>
      ) : view === 'colaj' ? (
        <div className="collage">
          {dreams.map((g, i) => (
            <button key={g.id} type="button" className={'collage-tile' + (i % 7 === 0 ? ' big' : '') + (isDone(g) ? ' done' : '')} onClick={() => openGoal(g)} style={{ ['--c' as any]: dreamCat(g.category).color }}>
              <DreamImage g={g} />
              {g.name && <span className="collage-name">{g.name}</span>}
              <TickBox g={g} onToggle={() => toggle(g)} />
            </button>
          ))}
        </div>
      ) : (
        <DreamCards dreams={dreams} openGoal={openGoal} toggle={toggle} />
      )}

      <div className="dream-actions">
        <button type="button" className="primary" onClick={() => setBulk(true)}><Images size={18} />Adaugă poze</button>
        <button type="button" className="ghost-btn" onClick={() => openGoal()}><Plus size={17} />Un vis cu sumă</button>
      </div>
      {all.length > 0 && (
        <button type="button" className="ghost-btn wide" disabled={exporting} onClick={exportImage}>
          <Download size={17} />{exporting ? 'Fac imaginea…' : 'Salvează colajul ca imagine de fundal'}
        </button>
      )}
      {bulk && <BulkAddSheet onClose={() => setBulk(false)} notify={notify} />}
    </div>
  )
}

function DreamCards({ dreams, openGoal, toggle }: { dreams: Goal[]; openGoal: (g?: Goal, add?: boolean) => void; toggle: (g: Goal) => void }) {
  const today = todayIso()
  return (
    <div className="dream-board">
      {dreams.map(g => {
        const p = g.target ? Math.min(100, pct(g.saved, g.target)) : null
        const need = g.target ? monthlyNeeded(g.target, g.saved, today, g.deadline) : null
        const c = dreamCat(g.category)
        return (
          <article key={g.id} className={'dream-card' + (isDone(g) ? ' done' : '')}>
            <button type="button" className="dream-photo" onClick={() => openGoal(g)} aria-label={`Modifică: ${dreamTitle(g)}`}>
              <DreamImage g={g} />
              <span className="dream-shade" />
              <span className="dream-chip" style={{ background: c.color }}>{c.name}</span>
              <TickBox g={g} onToggle={() => toggle(g)} />
              <span className="dream-cap big">
                <b>{dreamTitle(g)}</b>
                {g.note && <span className="dream-note">{g.note}</span>}
              </span>
            </button>
            {isDone(g) ? (
              <div className="dream-body"><b className="good">Realizat pe {g.done_on!.split('-').reverse().join('.')} ✓</b></div>
            ) : p !== null ? (
              <div className="dream-body">
                <div className="dream-row"><span className="num"><b>{fmt(g.saved).replace(',00', '')}</b> din {fmt(g.target).replace(',00', '')}</span><b className={'num ' + (isFunded(g) ? 'good' : '')}>{p}%</b></div>
                <span className="dream-bar solid"><i style={{ width: p + '%' }} /></span>
                <div className="dream-row muted small">
                  <span>{isFunded(g) ? 'Banii sunt strânși! 🎉' : `mai ai ${fmt(g.target - g.saved).replace(',00', '')}`}</span>
                  {!isFunded(g) && need !== null && <span className="num">~{fmt(need).replace(',00', '')} / lună</span>}
                </div>
                {!isFunded(g) && <button type="button" className="primary small dream-add" onClick={() => openGoal(g, true)}><Plus size={16} />Pun bani deoparte</button>}
              </div>
            ) : <div className="dream-body"><button type="button" className="link" onClick={() => openGoal(g)}>Pune o sumă ca să vezi cât mai ai <ChevronRight size={15} /></button></div>}
          </article>
        )
      })}
    </div>
  )
}

/* ---------- Adding many photos at once ---------- */

function BulkAddSheet({ onClose, notify }: { onClose: () => void; notify: (m: string) => void }) {
  const st = useStore()
  const [cat, setCat] = useState('calatorii')
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [err, setErr] = useState('')
  const input = useRef<HTMLInputElement>(null)

  async function add(files: File[]) {
    if (!files.length) return
    setErr(''); setBusy({ done: 0, total: files.length })
    let ok = 0
    for (const f of files.slice(0, 40)) {
      try {
        const c = await compress(f)
        const g = await st.saveGoal({ name: '', icon: dreamCat(cat).icon, target: 0, saved: 0, deadline: null, archived: false, category: cat })
        const path = await saveDreamPhoto(st.householdId, g.id, c.blob)
        await st.saveGoal({ id: g.id, photo_path: path })
        ok++
      } catch { /* skip this one */ }
      setBusy(b => b && { ...b, done: b.done + 1 })
    }
    setBusy(null)
    if (ok) { notify(`${ok} ${ok === 1 ? 'poză adăugată' : 'poze adăugate'} în colaj ✨`); onClose() }
    else setErr('Pozele nu s-au putut încărca. Verifică internetul și încearcă din nou.')
  }

  return (
    <Sheet title="Adaugă poze în colaj" onClose={busy ? () => {} : onClose}>
      <p className="hint">Alege rubrica, apoi selectezi oricâte poze din galerie (până la 40 odată). Numele le poți pune mai târziu, apăsând pe poză.</p>
      <div className="chips">
        {DREAM_CATS.map(c => <button key={c.id} type="button" className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}><i className="dot" style={{ background: c.color }} />{c.name}</button>)}
      </div>
      {busy ? (
        <div className="bulk-progress"><b>Încarc {busy.done} din {busy.total}…</b><span className="dream-bar solid"><i style={{ width: Math.round((busy.done / busy.total) * 100) + '%' }} /></span></div>
      ) : (
        <button type="button" className="primary" onClick={() => input.current?.click()}><Images size={18} />Alege pozele din galerie</button>
      )}
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={e => { add(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      {err && <p className="err">{err}</p>}
    </Sheet>
  )
}

/* ---------- Photo field for one dream ---------- */

export function DreamPhotoField({ current, value, onChange }: {
  current?: string | null; value: { blob: Blob; preview: string } | null | 'remove'; onChange: (v: { blob: Blob; preview: string } | null | 'remove') => void
}) {
  const shown = useDreamUrl(value && value !== 'remove' ? value.preview : value === 'remove' ? null : current)
  const cam = useRef<HTMLInputElement>(null), gal = useRef<HTMLInputElement>(null)
  async function pick(f?: File) {
    if (!f) return
    const c = await compress(f)
    onChange({ blob: c.blob, preview: URL.createObjectURL(c.blob) })
  }
  return (
    <div className="dream-field">
      {shown ? (
        <div className="dream-preview">
          <img src={shown} alt="Poza visului" />
          <button type="button" className="icon-btn" aria-label="Scoate poza" onClick={() => onChange(current ? 'remove' : null)}><X size={16} /></button>
        </div>
      ) : <div className="dream-preview empty"><ImagePlus size={28} /><span>O poză cu visul tău</span></div>}
      <div className="add-row">
        <button type="button" className="ghost-btn" onClick={() => gal.current?.click()}><ImagePlus size={16} />Din galerie</button>
        <button type="button" className="ghost-btn" onClick={() => cam.current?.click()}><Camera size={16} />Fă o poză</button>
      </div>
      <input ref={gal} type="file" accept="image/*" hidden onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
    </div>
  )
}

/* ---------- Wallpaper image (phone lock screen) ---------- */

async function loadBitmap(g: Goal): Promise<CanvasImageSource | null> {
  const p = g.photo_path
  if (!p) return null
  try {
    if (isLocal(p)) {
      const img = new Image(); img.src = p
      await img.decode()
      const w = img.naturalWidth || 800, h = img.naturalHeight || 600
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h
      cv.getContext('2d')!.drawImage(img, 0, 0, w, h)
      return cv
    }
    const { data } = await supabase!.storage.from('dreams').download(p)
    return data ? await createImageBitmap(data) : null
  } catch { return null }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

/** Phone-sized collage (1080×2340); the top stays calm for the lock-screen clock. */
export async function renderWallpaper(dreams: Goal[]): Promise<File> {
  const W = 1080, H = 2340, top = 620, bottom = 150, pad = 40, gap = 10
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d')!
  const bg = ctx.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#0B1630'); bg.addColorStop(0.55, '#16324F'); bg.addColorStop(1, '#2A1B4A')
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = '600 54px "IBM Plex Sans", system-ui, sans-serif'; ctx.textAlign = 'center'
  ctx.fillText('Visurile mele', W / 2, top - 70)

  const list = dreams.slice(0, 60)
  const n = Math.max(1, list.length)
  const areaW = W - pad * 2, areaH = H - top - bottom
  let cols = 2
  while (cols < 8 && Math.ceil(n / cols) * (areaW / cols) > areaH) cols++
  const size = Math.floor((areaW - gap * (cols - 1)) / cols)
  const rows = Math.ceil(n / cols)
  const y0 = top + Math.max(0, (areaH - (rows * size + gap * (rows - 1))) / 2)
  const bitmaps = await Promise.all(list.map(loadBitmap))

  list.forEach((g, i) => {
    const x = pad + (i % cols) * (size + gap), y = y0 + Math.floor(i / cols) * (size + gap)
    ctx.save(); roundRect(ctx, x, y, size, size, 18); ctx.clip()
    const bmp = bitmaps[i] as any
    if (bmp) {
      const sw = bmp.width, sh = bmp.height, k = Math.max(size / sw, size / sh)
      ctx.drawImage(bmp, (sw - size / k) / 2, (sh - size / k) / 2, size / k, size / k, x, y, size, size)
    } else {
      const gr = ctx.createLinearGradient(x, y, x + size, y + size); gr.addColorStop(0, dreamCat(g.category).color); gr.addColorStop(1, '#6D5DF6')
      ctx.fillStyle = gr; ctx.fillRect(x, y, size, size)
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'
      const t = dreamTitle(g)
      let fs = Math.round(size / 8)
      do { ctx.font = `600 ${fs}px system-ui, sans-serif`; fs -= 2 } while (fs > 14 && ctx.measureText(t).width > size - 24)
      ctx.fillText(t, x + size / 2, y + size / 2, size - 24)
    }
    ctx.restore()
    // Tick box in the corner, like the paper version.
    const b = Math.max(26, Math.round(size / 7)), bx = x + size - b - 10, by = y + 10
    ctx.save(); roundRect(ctx, bx, by, b, b, 6)
    ctx.fillStyle = g.done_on ? '#22C55E' : 'rgba(255,255,255,.92)'; ctx.fill()
    if (g.done_on) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(4, b / 7); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      ctx.beginPath(); ctx.moveTo(bx + b * 0.24, by + b * 0.52); ctx.lineTo(bx + b * 0.43, by + b * 0.7); ctx.lineTo(bx + b * 0.78, by + b * 0.3); ctx.stroke()
    }
    ctx.restore()
  })
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '500 34px "IBM Plex Sans", system-ui, sans-serif'; ctx.textAlign = 'center'
  ctx.fillText('Banii la virgulă', W / 2, H - 70)
  const blob = await new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('canvas'))), 'image/jpeg', 0.9))
  return new File([blob], `visurile-mele-${todayIso()}.jpg`, { type: 'image/jpeg' })
}
