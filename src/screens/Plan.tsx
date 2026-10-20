import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Check, Pencil, Pause, ShoppingCart, Trophy, RotateCcw } from 'lucide-react'
import { useStore } from '../store.tsx'
import { Seg } from '../ui.tsx'
import { useMarket } from './Radar.tsx'
import { useJournal } from './Journal.tsx'
import { buildContext, askAssistant, Rich } from './Assistant.tsx'
import { score, LABELS, dayOf, indexAt, marketChange, getMarket } from '../lib/radar.ts'
import { buildPlan, splitBySymbol, monthKey, type Plan } from '../lib/plan.ts'
import { autoReviews, ideaReturn, type JournalEntry } from '../lib/journal.ts'
import { todayIso } from '../lib/period.ts'
import { fitFee, limitPrice, priceDecimals, dividendInfo, DEFAULT_FEE, type FeeModel } from '../lib/market-extra.ts'

const n = (x: number, d = 0) => x.toLocaleString('ro-RO', { minimumFractionDigits: d, maximumFractionDigits: d })
const pct = (x: number | null) => (x == null ? '–' : `${x >= 0 ? '+' : ''}${n(x, 1)}%`)
const dmy = (d: string) => d.split('-').reverse().join('.')
const addDays = (iso: string, k: number) => new Date(Date.parse(iso) + k * 864e5).toISOString().slice(0, 10)
const MONTHS = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie']

export function PlanScreen({ notify }: { notify: (m: string) => void }) {
  const st = useStore()
  const { stocks } = useMarket()
  const { list, reload } = useJournal()
  const today = todayIso(), month = monthKey(today)
  const monthName = `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`
  const s = st.settings
  const defLei = s.fi_monthly ? Math.round((s.fi_monthly / 100) * (s.fi_currency === 'EUR' ? st.rates.EUR : 1)) : 1000
  const [amount, setAmount] = useState(String(defLei))
  const [core, setCore] = useState<'30' | '50' | '70'>(String(s.radar?.plan?.core ?? 50) as any)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [ai, setAi] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<'' | 'ai' | 'save'>('')
  const [err, setErr] = useState('')
  const [editAmount, setEditAmount] = useState(false)
  const [redo, setRedo] = useState(false)
  const [fee, setFee] = useState<FeeModel>(DEFAULT_FEE)
  // Broker fee learned from the user's own Tradeville orders.
  useEffect(() => {
    st.repo.list<any>('invest_tx', st.householdId).then(rows => setFee(fitFee(rows.filter(r => r.op === 'cump' && r.price != null && r.qty).map(r => ({ value: Math.abs(Number(r.price) * Number(r.qty)), fee: Number(r.commission ?? 0) / 100 }))))).catch(() => {})
  }, [st.householdId])

  const lei = Number(amount.replace(/\./g, '').replace(',', '.')) || 0
  const holdings = useMemo(() => st.assets.flatMap(a => a.holdings ?? []).map(h => ({ symbol: h.symbol, value: h.price ? h.qty * h.price : h.cost / 100 })), [st.assets])
  const scored = useMemo(() => (stocks ?? []).filter(x => x.t.length >= 220).map(x => ({ s: x, sc: score(x) })), [stocks])
  const accepted = (list ?? []).filter(e => e.source === 'plan' && e.plan_month === month)
  const skipped = s.radar?.plan?.skip === month
  const showPlan = (!accepted.length && !skipped) || redo

  function make() {
    if (!stocks) return
    if (lei < 100) return setErr('Pune cel puțin 100 de lei.')
    setErr(''); setAi({}); setEditAmount(false)
    const p = buildPlan({ stocks: scored, holdings, cash: lei, rules: s.radar?.rules ?? {}, corePct: Number(core), fee })
    setPlan(p)
    explain(p)
  }
  useEffect(() => { if (stocks && showPlan && !plan) make() }, [stocks, showPlan])

  async function explain(p: Plan) {
    if (!p.items.length) return
    setBusy('ai')
    try {
      const ctx = { ...buildContext(stocks, st), plan_propus: p.items.map(i => ({ simbol: i.symbol, rol: i.role, bucati: i.shares, lei: i.lei, pondere_inainte_pct: Math.round(i.weightBefore), pondere_dupa_pct: Math.round(i.weightAfter) })), lasate_deoparte: p.skipped }
      const q = `Sistemul meu a făcut planul de investiții pe ${monthName}: ${p.items.map(i => `${i.symbol} ${i.shares} buc (${Math.round(i.lei)} lei, ${i.role})`).join(', ')}.
Explică-l scurt, doar cu cifrele din CONTEXT. Începe cu 2 propoziții despre plan în ansamblu (cum schimbă portofoliul meu). Apoi pentru FIECARE simbol un titlu exact „### SIMBOL” și 4 rânduri:
**Fundamental:** … (P/E, P/BV, dividend, ROE)
**Tehnic:** … (trend față de mediile 50/200, RSI, MACD)
**Risc:** … (volatilitate, cădere maximă, cât din portofoliu va fi)
**De ce e în plan:** … o propoziție.
Fără sfaturi de tip „sigur va crește”. Fără secțiunea „Ce aș urmări”.`
      setAi(splitBySymbol(await askAssistant(q, ctx), p.items.map(i => i.symbol)))
    } catch (e: any) { setAi({ _intro: e?.message || 'Analiza AI nu a mers acum. Planul rămâne valabil — se bazează pe scoruri, nu pe AI.' }) }
    finally { setBusy('') }
  }

  async function accept() {
    if (!plan?.items.length) return
    setBusy('save'); setErr('')
    try {
      for (const i of plan.items) {
        const x = scored.find(k => k.s.symbol === i.symbol)
        await st.repo.insert('invest_journal', {
          household_id: st.householdId, member_id: st.user.id, symbol: i.symbol, action: 'cumpar', price_at: i.price,
          score_at: i.score, label_at: x ? LABELS[x.sc.label].text : null, amount: Math.round(i.lei * 100), shares: i.shares,
          thesis: ai[i.symbol] || i.why.join('. ') || 'Propunerea sistemului', confirm: '', exit_plan: 'Verificare automată la 3, 6 și 12 luni, față de bursă.',
          horizon_months: 12, ai_feedback: null, reviews: {}, status: 'deschis', created_on: today, source: 'plan', plan_month: month,
        })
      }
      if (skipped) await st.saveSettings({ radar: { ...s.radar, plan: { ...s.radar?.plan, skip: undefined } } })
      setRedo(false); await reload(); notify('Plan acceptat. Acum cumpără în Tradeville.')
    } catch (e: any) { setErr(e?.message || 'Nu s-a putut salva.') }
    finally { setBusy('') }
  }

  async function skip() {
    await st.saveSettings({ radar: { ...s.radar, plan: { ...s.radar?.plan, core: Number(core), skip: month } } })
    setRedo(false); notify('Ok, luna asta nu investești. Ne vedem luna viitoare.')
  }

  // The system's proposals fill their own 3/6/12-month checks.
  useEffect(() => {
    if (!list || !stocks) return
    const todo = list.filter(e => e.source === 'plan').map(e => {
      const sd = stocks.find(x => x.symbol === e.symbol)
      if (!sd) return null
      const add = autoReviews(e, today, iso => { const i = indexAt(sd, dayOf(iso)); return i >= 0 ? sd.c[i] : null }, (a, b) => { const m = marketChange(getMarket(), dayOf(a), dayOf(b)); return m == null ? null : Math.round(m * 10) / 10 })
      return add ? { e, add } : null
    }).filter(Boolean) as { e: JournalEntry; add: JournalEntry['reviews'] }[]
    if (!todo.length) return
    Promise.all(todo.map(({ e, add }) => st.repo.update('invest_journal', { id: e.id }, { reviews: { ...e.reviews, ...add } }))).then(reload).catch(() => {})
  }, [list?.length, stocks])

  const score_ = useMemo(() => {
    const sys = (list ?? []).filter(e => e.source === 'plan')
    const rev = sys.map(e => { const k = Object.keys(e.reviews ?? {}).map(Number).sort((a, b) => b - a)[0]; return k ? e.reviews[String(k)] : null }).filter(Boolean) as JournalEntry['reviews'][string][]
    const live = sys.map(e => { const sd = stocks?.find(x => x.symbol === e.symbol); return sd ? ideaReturn(e, sd.c[sd.c.length - 1]) : null }).filter(x => x != null) as number[]
    const first = sys.map(e => e.created_on).sort()[0]
    return { total: sys.length, rev: rev.length, beat: rev.filter(r => r.market != null && r.ret > r.market).length, avgNow: live.length ? live.reduce((a, b) => a + b, 0) / live.length : null, first }
  }, [list, stocks])

  const firstCheck = score_.first ? (() => { const d = new Date(score_.first + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 3); return d.toISOString().slice(0, 10).split('-').reverse().join('.') })() : null

  return (
    <div className="screen plan">
      <p className="muted">Sistemul aplică metodele tale (scorul Radar, regulile tale, limitele de risc) și îți propune ce să cumperi. <b>Tu doar decizi.</b></p>

      {score_.total > 0 && (
        <div className="card plan-score">
          <Trophy size={18} />
          <div>
            {score_.rev > 0
              ? <b>Propunerile sistemului: {score_.beat} din {score_.rev} au bătut bursa</b>
              : <b>{score_.total} propuneri urmărite · prima verificare pe {firstCheck}</b>}
            {score_.avgNow != null && <span className="muted small">Acum, în medie: {pct(score_.avgNow)} de la cumpărare</span>}
          </div>
        </div>
      )}

      {!showPlan && accepted.length > 0 && (
        <section className="card">
          <h2><ShoppingCart size={16} /> Ce cumperi în Tradeville · {monthName}</h2>
          <p className="muted small">Aplicația nu poate cumpăra în locul tău. În Tradeville pune pentru fiecare un ordin <b>limită</b> (nu „la piață”) la prețul maxim de mai jos. Dacă prețul a urcat peste el, nu te grăbi — reverifică planul.</p>
          <div className="buy-list">
            {accepted.map(e => (
              <div key={e.id} className="buy-row">
                <b className="sym">{e.symbol}</b>
                <span className="num">{e.shares != null ? n(e.shares) : '–'} buc</span>
                <span className="muted small num">limită max {n(limitPrice(e.price_at), priceDecimals(e.price_at))} lei</span>
                <b className="num">{n((e.amount ?? 0) / 100)} lei</b>
              </div>
            ))}
          </div>
          <p className="muted small">Salvat în jurnal. Peste 3, 6 și 12 luni aplicația verifică singură dacă a bătut bursa.</p>
          <button type="button" className="link" onClick={() => { setRedo(true); setPlan(null) }}><RotateCcw size={14} /> Încă o investiție luna asta</button>
        </section>
      )}

      {!showPlan && skipped && !accepted.length && (
        <section className="card">
          <h2><Pause size={16} /> Luna asta pauză</h2>
          <p className="muted small">E în regulă. Planul revine la începutul lunii viitoare.</p>
          <button type="button" className="link" onClick={() => { setRedo(true); setPlan(null) }}>M-am răzgândit, arată-mi planul</button>
        </section>
      )}

      {showPlan && <>
        <section className="card plan-head">
          <h2>Planul pe {monthName}</h2>
          {(editAmount || !plan) ? <>
            <label className="field">Cât investești luna asta (lei)
              <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
            </label>
            <Seg label="Cât merge în ETF (nucleu)" value={core} onChange={setCore} options={[{ id: '30', label: '30% ETF' }, { id: '50', label: '50% ETF' }, { id: '70', label: '70% ETF' }]} />
            <p className="muted small">ETF-ul BET = 20 de firme mari dintr-o dată (risc împărțit). Restul merge pe acțiunile cu cel mai bun scor.</p>
            <button type="button" className="primary" disabled={!stocks} onClick={make}>{stocks ? 'Fă planul' : 'Încarc bursa…'}</button>
          </> : <p className="plan-sum"><b className="num">{n(plan.invested)} lei</b> de investit <span className="muted">· comision ~{n(plan.fees, 2)} lei · rămân {n(plan.leftover)} lei</span></p>}
        </section>

        {plan && !editAmount && <>
          {plan.notes.map(t => <p key={t} className="note">{t}</p>)}
          {plan.sectors.length > 0 && (
            <div className="card sector-box">
              <b className="small">Pe sectoare, după plan</b>
              {plan.sectors.slice(0, 5).map(x => (
                <div key={x.name} className={'sector-row' + (x.after > 40 ? ' over' : '')}>
                  <span className="small">{x.name}</span>
                  <span className="sector-bar"><i style={{ width: Math.min(100, x.after) + '%' }} /><em style={{ left: '40%' }} /></span>
                  <span className="small num">{x.before}% → <b>{x.after}%</b></span>
                </div>
              ))}
              <span className="muted small">Linia verticală = limita de 40% pe un sector. ETF-ul nu intră aici, e deja diversificat.</span>
            </div>
          )}
          {ai._intro && <div className="card ai-box"><Rich text={ai._intro} /></div>}
          {plan.items.map(i => (
            <section key={i.symbol} className="card plan-item">
              <div className="plan-top">
                <div>
                  <b className="sym">{i.symbol}</b> <span className={'role ' + i.role}>{i.role === 'nucleu' ? 'Nucleu' : 'Satelit'}</span>
                  <div className="muted small">{i.name}</div>
                </div>
                <div className="right">
                  <b className="num">{n(i.lei)} lei</b>
                  <div className="muted small num">{n(i.shares)} buc × {n(i.price, i.price < 10 ? 3 : 2)}</div>
                </div>
              </div>
              <div className="plan-meta muted small">Scor {i.score} · {i.sector} · din portofoliu: {n(i.weightBefore, 0)}% → <b>{n(i.weightAfter, 0)}%</b></div>
              <div className="plan-meta small">Ordin <b>limită</b> la maximum <b className="num">{n(i.limit, priceDecimals(i.limit))} lei</b> · comision ~{n(i.fee, 2)} lei</div>
              {(() => { const sd = stocks?.find(x => x.symbol === i.symbol); const d = sd && dividendInfo(sd, today); return d?.buyBy && d.nextEstimate && d.nextEstimate <= addDays(today, 45) ? <div className="plan-meta small div-soon">💰 Dividend estimat curând (ex-dividend ~{dmy(d.nextEstimate)}). Ca să-l primești, cumpără până pe {dmy(d.buyBy)}.</div> : null })()}
              {ai[i.symbol] ? <div className="ai-box"><Rich text={ai[i.symbol]} /></div>
                : busy === 'ai' ? <p className="muted small"><Sparkles size={14} /> AI-ul scrie analiza…</p>
                : <ul className="small">{i.why.map(w => <li key={w}>{w}</li>)}</ul>}
            </section>
          ))}
          {plan.skipped.length > 0 && (
            <details className="card">
              <summary>De ce nu am pus altele ({plan.skipped.length})</summary>
              <ul className="small">{plan.skipped.map(x => <li key={x.symbol}><b>{x.symbol}</b> — {x.why}</li>)}</ul>
            </details>
          )}
          {err && <p className="error">{err}</p>}
          <div className="plan-actions">
            <button type="button" className="primary" disabled={!plan.items.length || busy === 'save'} onClick={accept}><Check size={18} />{busy === 'save' ? 'Salvez…' : 'Accept'}</button>
            <button type="button" onClick={() => setEditAmount(true)}><Pencil size={16} />Modific suma</button>
            <button type="button" onClick={skip}><Pause size={16} />Nu luna asta</button>
          </div>
          <p className="muted small">Propunerea e calculată după regulile tale, nu e un sfat financiar autorizat. Decizia și riscul sunt ale tale.</p>
        </>}
        {err && !plan && <p className="error">{err}</p>}
      </>}
    </div>
  )
}
