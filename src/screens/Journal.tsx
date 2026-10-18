import { useEffect, useMemo, useState } from 'react'
import { NotebookPen, Plus, Sparkles, Clock } from 'lucide-react'
import { useStore } from '../store.tsx'
import { Sheet, Seg, EmptyArt } from '../ui.tsx'
import { useMarket } from './Radar.tsx'
import { buildContext, askAssistant, Rich } from './Assistant.tsx'
import { score, dayOf, marketChange, getMarket, LABELS } from '../lib/radar.ts'
import { riskCalc, dueReviews, ideaReturn, journalStats, monthsSince, ACTIONS, type JournalEntry } from '../lib/journal.ts'
import { todayIso } from '../lib/period.ts'

const n = (x: number | null | undefined, d = 1) => (x == null ? '–' : x.toLocaleString('ro-RO', { minimumFractionDigits: d, maximumFractionDigits: d }))
const pct = (x: number | null | undefined) => (x == null ? '–' : `${x >= 0 ? '+' : ''}${n(x)}%`)
const dmy = (d: string) => d.split('-').reverse().join('.')
const lei = (bani: number) => Math.round(bani / 100).toLocaleString('ro-RO')

export function useJournal() {
  const st = useStore()
  const [list, setList] = useState<JournalEntry[] | null>(null)
  async function load() {
    try {
      const rows = await st.repo.list<JournalEntry>('invest_journal', st.householdId)
      setList(rows.map(r => ({ ...r, price_at: Number(r.price_at), stop_price: r.stop_price == null ? null : Number(r.stop_price), target_price: r.target_price == null ? null : Number(r.target_price), amount: r.amount == null ? null : Number(r.amount) }))
        .sort((a, b) => (b.created_at ?? b.created_on).localeCompare(a.created_at ?? a.created_on)))
    } catch { setList([]) }
  }
  useEffect(() => { load() }, [st.householdId])
  return { list, reload: load }
}

export function JournalScreen({ notify, initialSymbol }: { notify: (m: string) => void; initialSymbol?: string }) {
  const { list, reload } = useJournal()
  const { stocks } = useMarket()
  const [edit, setEdit] = useState<JournalEntry | 'new' | null>(initialSymbol ? 'new' : null)
  const [review, setReview] = useState<{ e: JournalEntry; cp: number } | null>(null)
  const today = todayIso()
  const priceOf = (sym: string) => { const s = stocks?.find(x => x.symbol === sym); return s ? s.c[s.c.length - 1] : null }
  const stats = useMemo(() => journalStats(list ?? []), [list])
  const due = (list ?? []).flatMap(e => dueReviews(e, today).map(cp => ({ e, cp })))

  return (
    <div className="screen">
      <p className="muted">Scrie de ce iei o decizie <b>înainte</b> s-o iei. Aplicația îți arată la 3, 6 și 12 luni cum a ieșit, ca să înveți din fiecare.</p>
      {stats.reviewed > 0 && (
        <div className="card import-sum">
          <div><span>Idei verificate</span><b className="num">{stats.reviewed}</b></div>
          <div><span>Au ieșit bine</span><b className="num in">{stats.wins} din {stats.reviewed}</b></div>
          <div><span>Au bătut bursa</span><b className="num">{stats.beat} din {stats.reviewed}</b></div>
        </div>
      )}
      {due.length > 0 && (
        <section className="card due-card">
          <h2><Clock size={16} /> E timpul să verifici</h2>
          {due.map(({ e, cp }) => <button key={e.id + cp} type="button" className="row" onClick={() => setReview({ e, cp })}><span className="row-main"><b>{e.symbol} · {cp} luni</b><span className="muted small">{ACTIONS[e.action]} pe {dmy(e.created_on)} la {n(e.price_at, 2)} lei</span></span><span className="row-side"><b className="num">{pct(priceOf(e.symbol) != null ? ideaReturn(e, priceOf(e.symbol)!) : null)}</b></span></button>)}
        </section>
      )}
      <button type="button" className="primary" onClick={() => setEdit('new')}><Plus size={18} />Ipoteză nouă</button>
      {list && !list.length && <EmptyArt icon="inbox" title="Prima ta ipoteză" text="De exemplu: „Cumpăr TLV pentru că P/E e 8,6 și trendul e bun. Mă răzgândesc dacă scade sub media de 200 de zile.” Apoi vezi peste 3 luni dacă ai avut dreptate." />}
      <div className="rows">
        {(list ?? []).map(e => {
          const p = priceOf(e.symbol), r = p != null ? ideaReturn(e, p) : null
          const mk = marketChange(getMarket(), dayOf(e.created_on), dayOf(today))
          return (
            <button key={e.id} type="button" className="row journal-row" onClick={() => setEdit(e)}>
              <span className={'j-act ' + e.action}>{ACTIONS[e.action].split(' ')[0]}</span>
              <span className="row-main"><b>{e.symbol}</b><span className="muted small">{dmy(e.created_on)} · la {n(e.price_at, 2)} lei{e.score_at != null ? ` · scor ${e.score_at}` : ''}</span><span className="small j-thesis">{e.thesis.slice(0, 90)}</span></span>
              <span className="row-side"><b className={'num ' + ((r ?? 0) >= 0 ? 'in' : 'bad')}>{pct(r)}</b>{mk != null && <span className="muted small num">bursa {pct(e.action === 'vand' ? -mk : mk)}</span>}</span>
            </button>
          )
        })}
      </div>
      {edit && <EntrySheet entry={edit === 'new' ? null : edit} initialSymbol={initialSymbol} onClose={() => setEdit(null)} onSaved={() => { reload(); setEdit(null) }} notify={notify} />}
      {review && <ReviewSheet e={review.e} cp={review.cp} price={priceOf(review.e.symbol)} onClose={() => setReview(null)} onSaved={() => { reload(); setReview(null); notify('Verificare salvată') }} />}
    </div>
  )
}

function EntrySheet({ entry, initialSymbol, onClose, onSaved, notify }: { entry: JournalEntry | null; initialSymbol?: string; onClose: () => void; onSaved: () => void; notify: (m: string) => void }) {
  const st = useStore()
  const { stocks } = useMarket()
  const [sym, setSym] = useState(entry?.symbol ?? initialSymbol ?? st.assets.flatMap(a => a.holdings ?? [])[0]?.symbol ?? 'TLV')
  const [action, setAction] = useState<JournalEntry['action']>(entry?.action ?? 'cumpar')
  const [amount, setAmount] = useState(entry?.amount ? String(Math.round(entry.amount / 100)) : '1000')
  const [stop, setStop] = useState(entry?.stop_price != null ? String(entry.stop_price).replace('.', ',') : '')
  const [target, setTarget] = useState(entry?.target_price != null ? String(entry.target_price).replace('.', ',') : '')
  const [thesis, setThesis] = useState(entry?.thesis ?? '')
  const [confirm, setConfirm] = useState(entry?.confirm ?? '')
  const [exit, setExit] = useState(entry?.exit_plan ?? '')
  const [horizon, setHorizon] = useState<'3' | '6' | '12'>(String(entry?.horizon_months ?? 12) as any)
  const [feedback, setFeedback] = useState(entry?.ai_feedback ?? '')
  const [busy, setBusy] = useState<'' | 'ai' | 'save'>('')
  const [err, setErr] = useState('')
  const stock = stocks?.find(s => s.symbol === sym)
  const sc = stock && stock.t.length >= 220 ? score(stock) : null
  const price = entry?.price_at ?? (stock ? stock.c[stock.c.length - 1] : null)
  const portfolio = st.assets.filter(a => a.holdings?.length).reduce((x, a) => x + a.value, 0) / 100
  const num = (v: string) => { const x = Number(v.replace(/\./g, '').replace(',', '.')); return Number.isFinite(x) && v.trim() ? x : null }
  const risk = price ? riskCalc({ portfolio, amount: num(amount) ?? 0, price, stop: num(stop), target: num(target) }) : null
  const symbols = useMemo(() => [...new Set([...(stocks ?? []).map(s => s.symbol), ...st.assets.flatMap(a => a.holdings ?? []).map(h => h.symbol)])].sort(), [stocks, st.assets])

  async function getFeedback() {
    if (!thesis.trim()) return setErr('Scrie întâi de ce vrei s-o faci.')
    setErr(''); setBusy('ai')
    try {
      const ctx = buildContext(stocks, st)
      const q = `Critică ipoteza mea de investiție, exigent și concret, pe datele din CONTEXT (Radar pentru ${sym} și portofoliul meu).
Acțiune: ${ACTIONS[action]} ${sym} la ~${price} lei, cu ${amount} lei, orizont ${horizon} luni.
De ce: ${thesis}
Ce ar confirma: ${confirm || '(necompletat)'}
Când recunosc că m-am înșelat / ies: ${exit || '(necompletat)'}${num(stop) ? `, stop-loss ${num(stop)} lei` : ''}${num(target) ? `, țintă ${num(target)} lei` : ''}
Spune: 1) ce e solid în raționament, 2) ce lipsește sau contrazic datele, 3) riscul pentru portofoliul meu, 4) ce întrebare ar trebui să-mi pun înainte. Fără să-mi spui „cumpără” sau „nu cumpăra”.`
      setFeedback(await askAssistant(q, ctx))
    } catch (e: any) { setErr(e?.message || 'Nu am putut primi feedback.') }
    finally { setBusy('') }
  }

  async function save() {
    if (!price) return setErr('Nu am prețul acțiunii. Așteaptă să se încarce Radarul.')
    if (!thesis.trim()) return setErr('Scrie de ce iei decizia — asta e partea cea mai importantă.')
    setBusy('save'); setErr('')
    const row: Partial<JournalEntry> = {
      household_id: st.householdId, member_id: st.user.id, symbol: sym, action, price_at: price,
      score_at: entry?.score_at ?? sc?.total ?? null, label_at: entry?.label_at ?? (sc ? LABELS[sc.label].text : null),
      amount: num(amount) != null ? Math.round(num(amount)! * 100) : null, thesis: thesis.trim(), confirm: confirm.trim(), exit_plan: exit.trim(),
      stop_price: num(stop), target_price: num(target), horizon_months: Number(horizon), ai_feedback: feedback || null,
    }
    try {
      if (entry) await st.repo.update('invest_journal', { id: entry.id }, row)
      else await st.repo.insert('invest_journal', { ...row, reviews: {}, status: 'deschis', created_on: todayIso() })
      notify(entry ? 'Ipoteză actualizată' : 'Ipoteză salvată. O verificăm peste 3 luni.'); onSaved()
    } catch (e: any) { setErr(e?.message || 'Nu s-a putut salva.') }
    finally { setBusy('') }
  }

  return (
    <Sheet title={entry ? `Ipoteza ${entry.symbol} · ${dmy(entry.created_on)}` : 'Ipoteză nouă'} onClose={onClose}>
      {!entry && <label className="field">Acțiunea
        <select value={sym} onChange={e => setSym(e.target.value)}>{symbols.map(s => <option key={s} value={s}>{s}</option>)}</select>
      </label>}
      <Seg label="Decizia" value={action} onChange={v => !entry && setAction(v)} options={[{ id: 'cumpar', label: 'Cumpăr' }, { id: 'vand', label: 'Vând' }, { id: 'astept', label: 'Aștept' }]} />
      <p className="note">{price ? <>Preț {entry ? 'atunci' : 'acum'}: <b>{n(price, price < 10 ? 3 : 2)} lei</b>{sc ? <> · Radar: {LABELS[sc.label].emoji} {sc.total}</> : null}</> : 'Încarc prețul…'}</p>

      <label className="field">De ce? (cel mai important)<textarea rows={3} value={thesis} onChange={e => setThesis(e.target.value)} placeholder="ex. P/E 8,6 e mic pentru o bancă cu ROE 22%, trendul e peste media de 200, iar dividendul crește." /></label>
      <label className="field">Ce ar confirma că am dreptate?<textarea rows={2} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="ex. profitul pe trimestrul următor crește, prețul rămâne peste 33 lei" /></label>
      <label className="field">Când recunosc că m-am înșelat?<textarea rows={2} value={exit} onChange={e => setExit(e.target.value)} placeholder="ex. dacă închide sub media de 200 sau taie dividendul" /></label>

      <div className="dep card-inner">
        <div className="dep-h">Riscul în bani</div>
        <div className="two">
          <label className="field">Suma (lei)<input inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <label className="field">Orizont<select value={horizon} onChange={e => setHorizon(e.target.value as any)}><option value="3">3 luni</option><option value="6">6 luni</option><option value="12">12 luni</option></select></label>
        </div>
        <div className="two">
          <label className="field">Stop-loss (lei)<input inputMode="decimal" value={stop} onChange={e => setStop(e.target.value)} placeholder={price ? n(price * 0.9, 2) : ''} /></label>
          <label className="field">Țintă (lei)<input inputMode="decimal" value={target} onChange={e => setTarget(e.target.value)} placeholder={price ? n(price * 1.2, 2) : ''} /></label>
        </div>
        {risk && action === 'cumpar' && <>
          <div className="inv-grid">
            <div><span>Cumperi</span><b className="num">{risk.shares} buc · {Math.round(risk.cost).toLocaleString('ro-RO')} lei</b></div>
            <div><span>Din portofoliu</span><b className="num">{n(risk.positionPct, 0)}%</b></div>
            <div><span>Dacă greșești</span><b className="num bad">{risk.loss != null ? `−${Math.round(risk.loss).toLocaleString('ro-RO')} lei (${n(risk.lossPct)}%)` : '–'}</b></div>
            <div><span>Dacă ai dreptate</span><b className="num in">{risk.gain != null ? `+${Math.round(risk.gain).toLocaleString('ro-RO')} lei` : '–'}</b></div>
            <div><span>Câștig / pierdere</span><b className="num">{risk.rr != null ? `${n(risk.rr)} : 1` : '–'}</b></div>
            {risk.maxShares2 != null && <div><span>Maxim ca să pierzi 2%</span><b className="num">{risk.maxShares2} buc</b></div>}
          </div>
          {risk.warnings.map((w, i) => <p key={i} className="note warn">⚠️ {w}</p>)}
        </>}
      </div>

      <button type="button" className="ghost-btn" disabled={busy !== ''} onClick={getFeedback}><Sparkles size={16} />{busy === 'ai' ? 'Asistentul citește ipoteza…' : feedback ? 'Cere alt feedback' : 'Cere feedback de la asistent'}</button>
      {feedback && <div className="msg model ai-feedback"><Rich text={feedback} /></div>}
      {err && <p className="err">{err}</p>}
      <div className="actions"><button type="button" className="primary" disabled={busy !== ''} onClick={save}><NotebookPen size={16} />{busy === 'save' ? 'Salvez…' : 'Salvează ipoteza'}</button></div>
      {entry && Object.keys(entry.reviews ?? {}).length > 0 && (
        <div className="dep card-inner">
          <div className="dep-h">Verificări</div>
          {Object.entries(entry.reviews).map(([k, r]) => <p key={k} className="small"><b>{k} luni</b> ({dmy(r.at)}): {pct(r.ret)}{r.market != null ? ` · bursa ${pct(r.market)}` : ''}{r.note ? ` — „${r.note}”` : ''}</p>)}
          {entry.lesson && <p className="note">Lecția: {entry.lesson}</p>}
        </div>
      )}
    </Sheet>
  )
}

function ReviewSheet({ e, cp, price, onClose, onSaved }: { e: JournalEntry; cp: number; price: number | null; onClose: () => void; onSaved: () => void }) {
  const st = useStore()
  const [note, setNote] = useState('')
  const [lesson, setLesson] = useState(e.lesson ?? '')
  const [close, setClose] = useState(cp >= e.horizon_months)
  const today = todayIso()
  const r = price != null ? ideaReturn(e, price) : null
  const mk0 = marketChange(getMarket(), dayOf(e.created_on), dayOf(today))
  const mk = mk0 == null ? null : e.action === 'vand' ? -mk0 : mk0
  async function save() {
    if (price == null || r == null) return
    const reviews = { ...(e.reviews ?? {}), [String(cp)]: { price, ret: Math.round(r * 10) / 10, market: mk == null ? null : Math.round(mk * 10) / 10, note: note.trim(), at: today } }
    await st.repo.update('invest_journal', { id: e.id }, { reviews, lesson: lesson.trim() || null, status: close ? 'inchis' : 'deschis' })
    onSaved()
  }
  return (
    <Sheet title={`${e.symbol} după ${cp} luni`} onClose={onClose}>
      <div className="inv-grid">
        <div><span>Atunci ({dmy(e.created_on)})</span><b className="num">{n(e.price_at, 2)} lei</b></div>
        <div><span>Acum</span><b className="num">{n(price, 2)} lei</b></div>
        <div><span>Rezultatul ideii</span><b className={'num ' + ((r ?? 0) >= 0 ? 'in' : 'bad')}>{pct(r)}</b></div>
        <div><span>Bursa în aceeași perioadă</span><b className="num">{pct(mk)}</b></div>
      </div>
      <div className="dep card-inner">
        <p className="small"><b>Ai zis:</b> {e.thesis}</p>
        {e.confirm && <p className="small"><b>Ar confirma:</b> {e.confirm}</p>}
        {e.exit_plan && <p className="small"><b>Ieșeai dacă:</b> {e.exit_plan}</p>}
      </div>
      <label className="field">Ce s-a întâmplat de fapt?<textarea rows={2} value={note} onChange={x => setNote(x.target.value)} placeholder="ex. profitul a crescut, dar a picat cu toată bursa" /></label>
      <label className="field">Ce iau cu mine (lecția)<textarea rows={2} value={lesson} onChange={x => setLesson(x.target.value)} placeholder="ex. P/E mic singur nu ajunge, contează și trendul" /></label>
      <label className="switch">Închid ideea<input type="checkbox" checked={close} onChange={x => setClose(x.target.checked)} /></label>
      <div className="actions"><button type="button" className="primary" onClick={save}>Salvează verificarea</button></div>
      <p className="hint">Au trecut {monthsSince(e.created_on, today).toFixed(1).replace('.', ',')} luni de la ipoteză. Nu contează doar dacă ai câștigat, ci dacă ai câștigat din motivul pe care l-ai scris.</p>
    </Sheet>
  )
}
