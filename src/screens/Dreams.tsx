import { useEffect, useRef, useState } from 'react'
import { Camera, ChevronRight, ImagePlus, Plus, X } from 'lucide-react'
import { useStore } from '../store.tsx'
import { supabase } from '../db.ts'
import { Icon } from '../icons.tsx'
import { fmt, pct } from '../lib/money.ts'
import { todayIso } from '../lib/period.ts'
import { monthlyNeeded } from '../lib/schedule.ts'
import { compress } from './Receipt.tsx'
import type { Goal } from '../lib/types.ts'
import type { Nav } from '../App.tsx'

/* Signed links to private photos, kept for ~50 minutes so scrolling doesn't re-ask the server. */
const urlCache = new Map<string, { url: string; until: number }>()
export function useDreamUrl(path?: string | null): string | null {
  const cached = path ? urlCache.get(path) : undefined
  const [url, setUrl] = useState<string | null>(path?.startsWith('data:') ? path : cached && cached.until > Date.now() ? cached.url : null)
  useEffect(() => {
    if (!path) { setUrl(null); return }
    if (path.startsWith('data:') || path.startsWith('blob:')) { setUrl(path); return }
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

/** The dream's photo, or a colourful placeholder with its icon. */
export function DreamImage({ g, className = '' }: { g: Pick<Goal, 'photo_path' | 'icon' | 'name'>; className?: string }) {
  const url = useDreamUrl(g.photo_path)
  return url
    ? <img className={'dream-img ' + className} src={url} alt={g.name} loading="lazy" />
    : <span className={'dream-img dream-ph ' + className} aria-hidden="true"><Icon name={g.icon || 'target'} size={30} /></span>
}

const isDone = (g: Goal) => g.target > 0 && g.saved >= g.target

/** Home: a row of dream photos to swipe through. */
export function DreamStrip({ openGoal, nav }: { openGoal: (g?: Goal, add?: boolean) => void; nav: Nav }) {
  const st = useStore()
  const dreams = st.goals.filter(g => !g.archived).sort((a, b) => Number(isDone(a)) - Number(isDone(b)))
  return (
    <section className="dreams-home">
      <div className="sec-head">
        <h2>Visurile mele</h2>
        {dreams.length > 0 && <button type="button" className="link" onClick={() => nav('visuri')}>Toate <ChevronRight size={15} /></button>}
      </div>
      <div className="dream-strip">
        {dreams.map(g => {
          const p = g.target ? Math.min(100, pct(g.saved, g.target)) : null
          return (
            <button key={g.id} type="button" className="dream-tile" onClick={() => nav('visuri')}>
              <DreamImage g={g} />
              <span className="dream-shade" />
              <span className="dream-cap">
                <b>{g.name}</b>
                {p !== null && <>
                  <span className="dream-bar"><i style={{ width: p + '%' }} /></span>
                  <span className="small num">{isDone(g) ? 'Atins! 🎉' : `${p}% · mai ai ${fmt(g.target - g.saved).replace(',00', '')}`}</span>
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

/** Full board: big photos, progress and the "put money aside" button. */
export function DreamsScreen({ openGoal }: { openGoal: (g?: Goal, add?: boolean) => void }) {
  const st = useStore()
  const today = todayIso()
  const dreams = st.goals.filter(g => !g.archived).sort((a, b) => Number(isDone(a)) - Number(isDone(b)))
  const total = dreams.reduce((a, g) => a + g.target, 0), saved = dreams.reduce((a, g) => a + Math.min(g.saved, g.target || g.saved), 0)
  return (
    <div className="screen">
      <p className="muted">Pentru ce muncești. Pune o poză la fiecare vis și urmărește cum se apropie.</p>
      {total > 0 && <div className="card import-sum">
        <div><span>Visuri</span><b className="num">{dreams.length}</b></div>
        <div><span>Strâns</span><b className="num in">{fmt(saved).replace(',00', '')}</b></div>
        <div><span>Din</span><b className="num">{fmt(total).replace(',00', '')}</b></div>
      </div>}
      <div className="dream-board">
        {dreams.map(g => {
          const p = g.target ? Math.min(100, pct(g.saved, g.target)) : null
          const need = g.target ? monthlyNeeded(g.target, g.saved, today, g.deadline) : null
          return (
            <article key={g.id} className="dream-card">
              <button type="button" className="dream-photo" onClick={() => openGoal(g)} aria-label={`Modifică: ${g.name}`}>
                <DreamImage g={g} />
                <span className="dream-shade" />
                <span className="dream-cap big">
                  <b>{g.name}</b>
                  {g.note && <span className="dream-note">{g.note}</span>}
                </span>
              </button>
              {p !== null ? (
                <div className="dream-body">
                  <div className="dream-row"><span className="num"><b>{fmt(g.saved).replace(',00', '')}</b> din {fmt(g.target).replace(',00', '')}</span><b className={'num ' + (isDone(g) ? 'good' : '')}>{p}%</b></div>
                  <span className="dream-bar solid"><i style={{ width: p + '%' }} /></span>
                  <div className="dream-row muted small">
                    <span>{isDone(g) ? 'Visul e acoperit! 🎉' : `mai ai ${fmt(g.target - g.saved).replace(',00', '')}`}</span>
                    {!isDone(g) && need !== null && <span className="num">~{fmt(need).replace(',00', '')} / lună</span>}
                  </div>
                  {!isDone(g) && <button type="button" className="primary small dream-add" onClick={() => openGoal(g, true)}><Plus size={16} />Pun bani deoparte</button>}
                </div>
              ) : <div className="dream-body"><button type="button" className="link" onClick={() => openGoal(g)}>Pune o sumă ca să vezi cât mai ai <ChevronRight size={15} /></button></div>}
            </article>
          )
        })}
      </div>
      <button type="button" className="ghost-btn dream-add-btn" onClick={() => openGoal()}><ImagePlus size={18} />Vis nou</button>
    </div>
  )
}

/** Photo field for the goal sheet: camera or gallery, shows a preview, can be removed. */
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
      <p className="hint">Poți salva o poză de pe internet (cabana pe care o vrei, mașina, o destinație) și o alegi din galerie.</p>
    </div>
  )
}

/** Uploads the chosen photo for a goal and returns its storage path (old one is removed). */
export async function saveDreamPhoto(householdId: string, goalId: string, blob: Blob, old?: string | null): Promise<string> {
  if (!supabase) return URL.createObjectURL(blob)
  const path = `${householdId}/${goalId}-${Date.now()}.jpg`
  const { error } = await supabase.storage.from('dreams').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw new Error('Poza nu s-a putut încărca. Încearcă din nou.')
  if (old && !old.startsWith('data:') && !old.startsWith('blob:')) supabase.storage.from('dreams').remove([old]).catch(() => {})
  return path
}
export async function removeDreamPhoto(old?: string | null) {
  if (supabase && old && !old.startsWith('data:') && !old.startsWith('blob:')) await supabase.storage.from('dreams').remove([old]).catch(() => {})
}
