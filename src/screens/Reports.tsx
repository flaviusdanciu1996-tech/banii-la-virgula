import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Landmark, HeartPulse, PiggyBank, Info, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useStore } from '../store.tsx'
import { Seg, Bar, BarsChart, Sheet, MoneyField, ConfirmButton } from '../ui.tsx'
import { fmt, fmtNum, fmtSigned, parseMoney } from '../lib/money.ts'
import { todayIso, periodFor, shiftPeriod, periodLabel, MONTHS, MONTHS_SHORT, iso, daysInMonth, inPeriod, type Period } from '../lib/period.ts'
import { summarize, savingsRate, snapshotAt } from '../lib/calc.ts'
import { fiscalReport, monthlyReserve, MANUAL_LABEL, RULES_CHECKED, type BrokerRow, type ManualIncome, type ManualKind, type FiscalReport } from '../lib/fiscal.ts'
import type { CryptoTx } from '../lib/crypto.ts'
import { toLei } from '../lib/crypto.ts'

type Tab = 'luna' | 'an' | 'fiscal'
const n = (v: unknown) => (v == null ? null : Number(v))
const pctTxt = (x: number | null) => (x == null ? '–' : `${String(x).replace('.', ',')}%`)
const dateRo = (d: string) => d.split('-').reverse().join('.')

/** Everything the reports need that isn't already in the store. */
function useInvestData() {
  const st = useStore()
  const [d, setD] = useState<{ broker: BrokerRow[]; crypto: CryptoTx[]; manual: ManualIncome[] } | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    ;(async () => {
      const [b, c, m] = await Promise.all([
        st.repo.list<any>('invest_tx', st.householdId).catch(() => []),
        st.repo.list<any>('crypto_tx', st.householdId).catch(() => []),
        st.repo.list<any>('fiscal_income', st.householdId).catch(() => []),
      ])
      if (!alive) return
      setD({
        broker: b.map(r => ({ at: String(r.at), op: r.op, symbol: r.symbol, qty: Number(r.qty), price: n(r.price), commission: Number(r.commission ?? 0), net: Number(r.net ?? 0), profit: n(r.profit), note: r.note ?? '' })),
        crypto: c.map(r => ({ ...r, qty: Number(r.qty), price: n(r.price), fee: Number(r.fee ?? 0), fx: n(r.fx) })),
        manual: m.map(r => ({ ...r, amount: Number(r.amount), tax_withheld: Number(r.tax_withheld ?? 0) })),
      })
    })()
    return () => { alive = false }
  }, [st.repo, st.householdId, tick])
  return { data: d, reload: () => setTick(t => t + 1) }
}

/** Investment activity (lei, bani) between two days. */
function investIn(p: Period, broker: BrokerRow[], crypto: CryptoTx[]) {
  const inP = (at: string) => inPeriod(at.slice(0, 10), p)
  const b = broker.filter(r => inP(r.at))
  const c = crypto.filter(t => inP(t.at))
  return {
    bvbBought: b.filter(r => r.op === 'cump').reduce((a, r) => a - r.net, 0),
    bvbSoldProfit: b.filter(r => r.op === 'vanz').reduce((a, r) => a + (r.profit ?? 0), 0),
    dividends: b.filter(r => r.op === 'div').reduce((a, r) => a + r.net, 0),
    deposits: b.filter(r => r.op === 'in' && /depunere/i.test(r.note)).reduce((a, r) => a + r.net, 0),
    cryptoBought: Math.round(c.filter(t => t.kind === 'buy').reduce((a, t) => a + toLei(t, (t.price ?? 0) * t.qty + t.fee), 0) * 100),
    cryptoSold: Math.round(c.filter(t => t.kind === 'sell').reduce((a, t) => a + toLei(t, (t.price ?? 0) * t.qty - t.fee), 0) * 100),
  }
}

export function ReportsScreen({ notify, initial }: { notify: (m: string) => void; initial?: string }) {
  const [tab, setTab] = useState<Tab>((initial as Tab) || 'luna')
  const { data, reload } = useInvestData()
  return (
    <div className="screen">
      <Seg label="Raport" value={tab} onChange={setTab} options={[{ id: 'luna', label: 'Lunar' }, { id: 'an', label: 'Anual' }, { id: 'fiscal', label: 'Fiscal' }]} />
      {tab === 'luna' && <MonthReport data={data} />}
      {tab === 'an' && <YearReport data={data} />}
      {tab === 'fiscal' && <FiscalTab data={data} reload={reload} notify={notify} />}
    </div>
  )
}

function Stepper({ label, onPrev, onNext, canNext }: { label: string; onPrev: () => void; onNext: () => void; canNext: boolean }) {
  return (
    <div className="period rep-period">
      <button type="button" className="icon-btn" aria-label="Înapoi" onClick={onPrev}><ChevronLeft size={18} /></button>
      <b>{label}</b>
      <button type="button" className="icon-btn" aria-label="Înainte" disabled={!canNext} onClick={onNext}><ChevronRight size={18} /></button>
    </div>
  )
}

function Delta({ now, before, invert }: { now: number; before: number | null; invert?: boolean }) {
  if (before == null || before === 0) return null
  const d = Math.round(((now - before) / before) * 100)
  const good = invert ? d <= 0 : d >= 0
  return <span className={'small ' + (good ? 'in' : 'bad')}>{d >= 0 ? '+' : ''}{d}%</span>
}

/* ---------------- Monthly ---------------- */

function MonthReport({ data }: { data: ReturnType<typeof useInvestData>['data'] }) {
  const st = useStore()
  const today = todayIso(), pay = st.settings.payday
  const [off, setOff] = useState(-1) // last finished month by default
  const p = shiftPeriod(periodFor(today, pay), off, pay)
  const s = summarize(st.txs, st.categories, st.settings, p, today)
  const prev = summarize(st.txs, st.categories, st.settings, shiftPeriod(p, -1, pay), today)
  const avg3 = [1, 2, 3].map(k => summarize(st.txs, st.categories, st.settings, shiftPeriod(p, -k, pay), today).spent)
  const had = avg3.filter(x => x > 0)
  const avgSpent = had.length ? Math.round(had.reduce((a, x) => a + x, 0) / had.length) : null
  const rate = savingsRate(s.income, s.spent)
  const cats = [...s.byCat.entries()].map(([id, v]) => ({ c: st.categories.find(c => c.id === id), v })).filter(x => x.c && x.c.grp !== 'economii').sort((a, b) => b.v - a.v)
  const top = cats.slice(0, 5)
  const biggest = s.txs.filter(t => t.kind !== 'in' && st.categories.find(c => c.id === t.category_id)?.grp !== 'economii').sort((a, b) => b.amount - a.amount).slice(0, 3)
  const nwStart = snapshotAt(st.snapshots, shiftPeriod(p, -1, pay).end), nwEnd = snapshotAt(st.snapshots, p.end > today ? today : p.end)
  const inv = data ? investIn(p, data.broker, data.crypto) : null
  return (
    <>
      <Stepper label={periodLabel(p, pay)} onPrev={() => setOff(o => o - 1)} onNext={() => setOff(o => o + 1)} canNext={off < 0} />
      {off === 0 && <p className="hint">Luna e încă în curs: cifrele se schimbă până la final.</p>}
      <section className="card">
        <h2>Pe scurt</h2>
        <div className="rep-grid">
          <div><span>Venituri</span><b className="num in">{fmt(s.income)}</b><Delta now={s.income} before={prev.income} /></div>
          <div><span>Cheltuieli</span><b className="num">{fmt(s.spent)}</b><Delta now={s.spent} before={prev.spent} invert /></div>
          <div><span>Pus deoparte</span><b className="num">{fmt(s.saved)}</b></div>
          <div><span>Rata de economisire</span><b className={'num ' + ((rate ?? 0) >= (st.settings.savings_target_pct ?? 20) ? 'in' : '')}>{pctTxt(rate)}</b><span className="small muted">ținta ta: {st.settings.savings_target_pct ?? 20}%</span></div>
        </div>
        {avgSpent != null && <p className="note">Ai cheltuit {s.spent <= avgSpent ? 'mai puțin' : 'mai mult'} decât media lunilor dinainte ({fmt(avgSpent)}): {fmtSigned(s.spent - avgSpent)}.</p>}
      </section>
      {top.length > 0 && (
        <section className="card">
          <h2>Pe ce s-au dus banii</h2>
          <div className="rep-cats">
            {top.map(({ c, v }) => (
              <div key={c!.id}>
                <div className="rep-cat-top"><span>{c!.name}</span><b className="num">{fmt(v)}</b></div>
                <Bar value={s.spent ? (v / s.spent) * 100 : 0} color="var(--accent)" />
              </div>
            ))}
          </div>
          {biggest.length > 0 && <>
            <h3 className="sub-h">Cele mai mari cheltuieli</h3>
            {biggest.map(t => <div key={t.id} className="rep-line"><span>{t.note || st.categories.find(c => c.id === t.category_id)?.name} · {dateRo(t.date)}</span><b className="num">{fmt(t.amount)}</b></div>)}
          </>}
        </section>
      )}
      <section className="card">
        <h2>Averea și investițiile</h2>
        {nwStart && nwEnd ? <div className="rep-line"><span>Averea netă: {fmt(nwStart.net)} → {fmt(nwEnd.net)}</span><b className={'num ' + (nwEnd.net >= nwStart.net ? 'in' : 'bad')}>{fmtSigned(nwEnd.net - nwStart.net)}</b></div>
          : <p className="muted small">Încă nu am istoricul averii pentru luna asta.</p>}
        {inv && <>
          {inv.bvbBought > 0 && <div className="rep-line"><span>Acțiuni cumpărate (Tradeville)</span><b className="num">{fmt(inv.bvbBought)}</b></div>}
          {inv.bvbSoldProfit !== 0 && <div className="rep-line"><span>Profit din acțiuni vândute</span><b className={'num ' + (inv.bvbSoldProfit >= 0 ? 'in' : 'bad')}>{fmtSigned(inv.bvbSoldProfit)}</b></div>}
          {inv.dividends > 0 && <div className="rep-line"><span>Dividende încasate</span><b className="num in">{fmt(inv.dividends)}</b></div>}
          {inv.cryptoBought > 0 && <div className="rep-line"><span>Crypto cumpărat</span><b className="num">{fmt(inv.cryptoBought)}</b></div>}
          {inv.cryptoSold > 0 && <div className="rep-line"><span>Crypto vândut</span><b className="num">{fmt(inv.cryptoSold)}</b></div>}
          {!inv.bvbBought && !inv.bvbSoldProfit && !inv.dividends && !inv.cryptoBought && !inv.cryptoSold && <p className="muted small">Nicio mișcare la investiții luna asta.</p>}
        </>}
      </section>
    </>
  )
}

/* ---------------- Yearly ---------------- */

function YearReport({ data }: { data: ReturnType<typeof useInvestData>['data'] }) {
  const st = useStore()
  const today = todayIso(), thisYear = Number(today.slice(0, 4))
  const [y, setY] = useState(thisYear)
  const months = MONTHS.map((_, m) => ({ start: iso(y, m, 1), end: iso(y, m, daysInMonth(y, m)) })).filter(p => p.start <= today)
  const rows = months.map(p => ({ p, s: summarize(st.txs, st.categories, st.settings, p, today) }))
  const tot = rows.reduce((a, r) => ({ income: a.income + r.s.income, spent: a.spent + r.s.spent, saved: a.saved + r.s.saved }), { income: 0, spent: 0, saved: 0 })
  const year: Period = { start: `${y}-01-01`, end: `${y}-12-31` }
  const all = summarize(st.txs, st.categories, st.settings, year, today)
  const cats = [...all.byCat.entries()].map(([id, v]) => ({ c: st.categories.find(c => c.id === id), v })).filter(x => x.c && x.c.grp !== 'economii').sort((a, b) => b.v - a.v).slice(0, 6)
  const nwStart = snapshotAt(st.snapshots, `${y - 1}-12-31`), nwEnd = snapshotAt(st.snapshots, y === thisYear ? today : `${y}-12-31`)
  const inv = data ? investIn(year, data.broker, data.crypto) : null
  const best = rows.filter(r => r.s.income > 0).sort((a, b) => (savingsRate(b.s.income, b.s.spent) ?? 0) - (savingsRate(a.s.income, a.s.spent) ?? 0))[0]
  return (
    <>
      <Stepper label={String(y)} onPrev={() => setY(v => v - 1)} onNext={() => setY(v => v + 1)} canNext={y < thisYear} />
      <section className="card">
        <h2>Anul pe scurt</h2>
        <div className="rep-grid">
          <div><span>Venituri</span><b className="num in">{fmt(tot.income)}</b></div>
          <div><span>Cheltuieli</span><b className="num">{fmt(tot.spent)}</b></div>
          <div><span>Pus deoparte</span><b className="num">{fmt(tot.saved)}</b></div>
          <div><span>Rata de economisire</span><b className="num">{pctTxt(savingsRate(tot.income, tot.spent))}</b></div>
        </div>
        {rows.some(r => r.s.income || r.s.spent) && <BarsChart rows={rows.map(r => ({ label: MONTHS_SHORT[Number(r.p.start.slice(5, 7)) - 1], a: r.s.income, b: r.s.spent }))} />}
        <div className="legend"><span><i style={{ background: 'var(--in)' }} />Venituri</span><span><i style={{ background: 'var(--out-bar)' }} />Cheltuieli</span></div>
        {best && <p className="note">Cea mai bună lună: {MONTHS[Number(best.p.start.slice(5, 7)) - 1]} ({pctTxt(savingsRate(best.s.income, best.s.spent))} economisit).</p>}
      </section>
      {cats.length > 0 && (
        <section className="card">
          <h2>Unde s-au dus banii în {y}</h2>
          <div className="rep-cats">
            {cats.map(({ c, v }) => (
              <div key={c!.id}>
                <div className="rep-cat-top"><span>{c!.name}</span><b className="num">{fmt(v)} <span className="muted small">· {fmtNum(Math.round(v / Math.max(1, rows.length)))}/lună</span></b></div>
                <Bar value={all.spent ? (v / all.spent) * 100 : 0} color="var(--accent)" />
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="card">
        <h2>Averea și investițiile în {y}</h2>
        {nwStart && nwEnd ? <div className="rep-line"><span>Averea netă: {fmt(nwStart.net)} → {fmt(nwEnd.net)}</span><b className={'num ' + (nwEnd.net >= nwStart.net ? 'in' : 'bad')}>{fmtSigned(nwEnd.net - nwStart.net)}</b></div>
          : nwEnd ? <div className="rep-line"><span>Averea netă acum</span><b className="num">{fmt(nwEnd.net)}</b></div> : null}
        {inv && <>
          <div className="rep-line"><span>Depuneri în Tradeville</span><b className="num">{fmt(inv.deposits)}</b></div>
          <div className="rep-line"><span>Acțiuni cumpărate</span><b className="num">{fmt(inv.bvbBought)}</b></div>
          <div className="rep-line"><span>Profit din acțiuni vândute</span><b className={'num ' + (inv.bvbSoldProfit >= 0 ? 'in' : 'bad')}>{fmtSigned(inv.bvbSoldProfit)}</b></div>
          <div className="rep-line"><span>Dividende încasate (net)</span><b className="num in">{fmt(inv.dividends)}</b></div>
          <div className="rep-line"><span>Crypto cumpărat / vândut</span><b className="num">{fmt(inv.cryptoBought)} / {fmt(inv.cryptoSold)}</b></div>
        </>}
      </section>
    </>
  )
}

/* ---------------- Fiscal ---------------- */

function FiscalTab({ data, reload, notify }: { data: ReturnType<typeof useInvestData>['data']; reload: () => void; notify: (m: string) => void }) {
  const today = todayIso(), thisYear = Number(today.slice(0, 4))
  // Until 25 May the previous year's declaration is the urgent one.
  const [y, setY] = useState(today <= `${thisYear}-05-25` ? thisYear - 1 : thisYear)
  const [sheet, setSheet] = useState<{ m?: ManualIncome } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const r: FiscalReport | null = useMemo(() => (data ? fiscalReport(y, data.broker, data.crypto, data.manual) : null), [data, y])
  if (!r) return <p className="muted">Se încarcă…</p>
  const R = r.rules, mw = R.minWage
  const done = today > r.deadline
  const reserve = monthlyReserve(r.totalToPay, today, r.deadline)
  const top = 24 * mw * 1.08
  const pos = (v: number) => `${Math.min(100, (v / top) * 100)}%`
  return (
    <>
      <Stepper label={`Veniturile din ${y}`} onPrev={() => setY(v => v - 1)} onNext={() => setY(v => v + 1)} canNext={y < thisYear} />
      <section className="card budget">
        <div className="eyebrow">Declarația unică · {done ? 'termen trecut' : `până la ${dateRo(r.deadline)}`}</div>
        <div className="big num">{fmt(r.totalToPay)}</div>
        <p className="muted small">de plătit de tine (impozit + CASS + CAS). Impozitele reținute deja la sursă: {fmt(r.withheld)}.</p>
        {!done && r.totalToPay > 0 && y >= thisYear - 1 && <p className="note"><PiggyBank size={15} /> Pune deoparte <b>{fmt(reserve.perMonth)}</b> pe lună în următoarele {reserve.months} luni.</p>}
      </section>

      <section className="card">
        <h2><HeartPulse size={18} /> CASS (sănătate) · {fmt(r.cassDue)}</h2>
        <p className="hint">Se adună veniturile din investiții și dividende: <b className="num">{fmt(r.cassBase)}</b>. CASS e 10% dintr-o sumă fixă, după treaptă (salariul minim {fmtNum(mw).replace(',00', '')} lei).</p>
        <div className="cass-scale">
          <div className="cass-track"><i style={{ width: pos(r.cassBase) }} /></div>
          {R.cassSteps.map(m => <span key={m} className={'cass-mark' + (r.cassBase >= m * mw ? ' on' : '')} style={{ left: pos(m * mw) }}><em>{m}</em></span>)}
        </div>
        <div className="cass-steps">
          {[{ mult: 0, at: 0, due: 0 }, ...R.cassSteps.map(m => ({ mult: m, at: m * mw, due: Math.round(m * mw * R.cassRate) }))].map((s, i, arr) => {
            const next = arr[i + 1]
            const here = r.cassBase >= s.at && (!next || r.cassBase < next.at)
            return <div key={s.mult} className={here ? 'on' : ''}><span>{s.mult === 0 ? `sub ${fmtNum(R.cassSteps[0] * mw).replace(',00', '')}` : next ? `${fmtNum(s.at).replace(',00', '')} – ${fmtNum(next.at).replace(',00', '')}` : `peste ${fmtNum(s.at).replace(',00', '')}`}</span><b className="num">{fmt(s.due)}</b></div>
          })}
        </div>
        {r.cassNext && <p className={'note ' + (r.cassNext.left < 5 * mw ? 'warn' : '')}>{r.cassNext.left < 5 * mw ? <AlertTriangle size={15} /> : <Info size={15} />} Mai ai <b>{fmt(r.cassNext.left)}</b> până la treapta de {r.cassNext.mult} salarii, unde CASS devine {fmt(r.cassNext.due)}. Dividendele de la firmă te pot muta acolo.</p>}
        {!r.cassNext && <p className="note">Ești la treapta maximă: CASS nu mai crește, oricât ai câștiga.</p>}
      </section>

      <section className="card">
        <h2><Landmark size={18} /> Impozite</h2>
        {r.lines.length === 0 && <p className="muted small">Niciun venit din investiții în {y} încă.</p>}
        <div className="rows fisc-rows">
          {r.lines.map(l => (
            <div key={l.key} className="fisc-line">
              <button type="button" className="fisc-head" onClick={() => setOpen(o => (o === l.key ? null : l.key))}>
                <span className="row-main"><b>{l.label}</b><span className="muted small">{l.note}</span></span>
                <span className="row-side">
                  <b className={'num ' + (l.gross >= 0 ? '' : 'bad')}>{fmt(l.gross)}{l.estimated ? '*' : ''}</b>
                  {l.withheld > 0 && <span className="num small muted">reținut {fmt(l.withheld)}</span>}
                  {l.toPay > 0 ? <span className="num small bad">de plătit {fmt(l.toPay)}</span> : <span className="small in"><CheckCircle2 size={12} /> nimic de plătit</span>}
                </span>
              </button>
              {open === l.key && l.details && (
                <div className="fisc-details">
                  {l.details.map((d, i) => {
                    const m = data?.manual.find(x => x.day === d.day && x.amount === d.amount && (x.note || MANUAL_LABEL[x.kind]) === d.text)
                    return <button key={i} type="button" className="rep-line" disabled={!m} onClick={() => m && setSheet({ m })}><span>{dateRo(d.day)} · {d.text}</span><b className={'num ' + (d.amount >= 0 ? '' : 'bad')}>{fmt(d.amount)}</b></button>
                  })}
                </div>
              )}
            </div>
          ))}
          <button type="button" className="row add-line" onClick={() => setSheet({})}><Plus size={16} />Adaugă un venit (dividende de la firmă, dobânzi, chirii…)</button>
        </div>
        {r.lines.some(l => l.estimated) && <p className="hint">* estimat din datele importate; cifra exactă e în fișa anuală de la broker.</p>}
      </section>

      <section className="card">
        <h2>CAS (pensie) · {fmt(r.casDue)}</h2>
        {r.casBase > 0
          ? <p className="hint">Din activități independente: {fmt(r.casBase)}. Pragurile sunt 12 salarii ({fmt(12 * mw)}) → {fmt(Math.round(12 * mw * R.casRate))} și 24 salarii ({fmt(24 * mw)}) → {fmt(Math.round(24 * mw * R.casRate))}.</p>
          : <p className="hint">CAS nu se plătește pe investiții, dividende sau crypto. Doar pe venituri din PFA sau drepturi de autor (praguri: 12 și 24 de salarii minime). Dacă ai așa ceva, adaugă-l mai sus ca „PFA / drepturi de autor”.</p>}
      </section>

      <section className="card">
        <h2>Ce treci în Declarația unică</h2>
        <ol className="fisc-todo">
          {r.lines.filter(l => l.toPay > 0).map(l => <li key={l.key}><b>{l.label}</b>: venit net {fmt(l.gross)}, impozit {fmt(l.toPay)}.</li>)}
          {r.cassDue > 0 ? <li><b>CASS</b> pentru venituri din investiții/dividende: venit total {fmt(r.cassBase)}, treapta de {r.cassStep!.mult} salarii minime → <b>{fmt(r.cassDue)}</b>.</li>
            : <li>Sub {R.cassSteps[0]} salarii minime: <b>nu datorezi CASS</b> pe veniturile din investiții.</li>}
          {r.casDue > 0 && <li><b>CAS</b>: {fmt(r.casDue)} (treapta de {r.casStep!.mult} salarii).</li>}
          {r.lines.some(l => l.key === 'bvb_gain' || l.key === 'bvb_div') && <li>Câștigurile și dividendele de la Tradeville au impozitul deja reținut: nu le mai plătești, dar contează la CASS.</li>}
          <li>Depui în SPV (formularul 212) și plătești până la <b>{dateRo(r.deadline)}</b>.</li>
        </ol>
        {r.notes.map((t, i) => <p key={i} className="note warn"><AlertTriangle size={15} /> {t}</p>)}
        <p className="hint">Reguli folosite pentru {y}: dividende {Math.round(R.divRate * 100)}%, acțiuni prin broker român {R.bvbLong * 100}% / {R.bvbShort * 100}%, crypto {Math.round(R.cryptoRate * 100)}%, CASS {R.cassRate * 100}% pe treptele {R.cassSteps.join('/')} salarii minime. Verificate la {RULES_CHECKED}. Nu e consultanță fiscală — verifică înainte de depunere.</p>
      </section>

      {sheet && <ManualSheet m={sheet.m} year={y} notify={notify} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); reload() }} divRate={R.divRate} />}
    </>
  )
}

function ManualSheet({ m, year, divRate, notify, onClose, onSaved }: { m?: ManualIncome; year: number; divRate: number; notify: (t: string) => void; onClose: () => void; onSaved: () => void }) {
  const st = useStore()
  const [kind, setKind] = useState<ManualKind>(m?.kind ?? 'srl_div')
  const [amount, setAmount] = useState(m ? fmtNum(m.amount) : '')
  const [withheld, setWithheld] = useState(m ? fmtNum(m.tax_withheld) : '')
  const [touched, setTouched] = useState(!!m)
  const [day, setDay] = useState(m?.day ?? (String(year) === todayIso().slice(0, 4) ? todayIso() : `${year}-12-31`))
  const [note, setNote] = useState(m?.note ?? '')
  const [err, setErr] = useState('')
  const autoRate = kind === 'srl_div' ? divRate : kind === 'interest' ? 0.1 : 0
  const a = parseMoney(amount)
  useEffect(() => { if (!touched) setWithheld(a && autoRate ? fmtNum(Math.round(a * autoRate)) : '') }, [a, autoRate, touched])
  async function save() {
    if (!a || a <= 0) return setErr('Scrie suma brută (înainte de impozit).')
    const w = withheld.trim() ? parseMoney(withheld) : 0
    if (w === null || w < 0) return setErr('Impozitul reținut nu e valid.')
    const row = { household_id: st.householdId, member_id: st.user.id, kind, amount: a, tax_withheld: w, day, note: note.trim() }
    try {
      if (m?.id) await st.repo.update('fiscal_income' as any, { id: m.id }, row as any)
      else await st.repo.insert('fiscal_income' as any, row as any)
      notify('Salvat'); onSaved()
    } catch (e: any) { setErr(e?.message || 'Nu s-a putut salva.') }
  }
  return (
    <Sheet title={m ? 'Modifică venitul' : 'Adaugă un venit'} onClose={onClose}>
      <label className="field">Ce fel de venit
        <select value={kind} onChange={e => setKind(e.target.value as ManualKind)}>
          {(Object.keys(MANUAL_LABEL) as ManualKind[]).map(k => <option key={k} value={k}>{MANUAL_LABEL[k]}</option>)}
        </select>
      </label>
      <label className="field">{kind === 'independent' ? 'Venit net pe an' : kind === 'foreign_gain' ? 'Câștig net (negativ dacă e pierdere)' : 'Suma brută (înainte de impozit)'}</label>
      <MoneyField id="fi-amount" big value={amount} onChange={setAmount} suffix="lei" autoFocus={!m} />
      <label className="field">Impozit reținut deja</label>
      <MoneyField id="fi-tax" value={withheld} onChange={v => { setTouched(true); setWithheld(v) }} suffix="lei" />
      {kind === 'srl_div' && <p className="hint">La dividendele de la firmă, firma reține {Math.round(divRate * 100)}% și îl plătește (D100). Tu le treci în declarație doar pentru CASS.</p>}
      <label className="field">Data încasării<input type="date" value={day} onChange={e => setDay(e.target.value)} /></label>
      <label className="field">Notă<input maxLength={80} placeholder="opțional" value={note} onChange={e => setNote(e.target.value)} /></label>
      {err && <p className="err">{err}</p>}
      <div className="actions">
        {m?.id && <ConfirmButton onConfirm={async () => { await st.repo.remove('fiscal_income' as any, { id: m.id }); notify('Șters'); onSaved() }} />}
        <button type="button" className="primary" onClick={save}>Salvează</button>
      </div>
    </Sheet>
  )
}
