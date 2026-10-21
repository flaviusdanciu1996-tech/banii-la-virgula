import { useMemo, useState } from 'react'
import { Flag, Pencil } from 'lucide-react'
import { useStore } from '../store.tsx'
import { Sheet, MoneyField, Seg } from '../ui.tsx'
import { parseMoney, fmtNum, toRon } from '../lib/money.ts'
import { todayIso } from '../lib/period.ts'
import { kindOf } from '../lib/types.ts'
import { monthsToTarget, safeMonthly, potForSpending, addMonthsLabel } from '../lib/fi.ts'

const RETURNS = [5, 7, 10]
const STEPS = [10, 50, 100, 200, 500]

/** Avere: the financial-independence goal — target, what you have, what's left, and when you get there. */
export function FiCard() {
  const st = useStore()
  const s = st.settings
  const [edit, setEdit] = useState(false)
  const cur = s.fi_currency || 'EUR'
  const rate = cur === 'EUR' ? st.rates.EUR : 1
  const sym = cur === 'EUR' ? '€' : 'lei'
  const today = todayIso()
  const toCur = (lei: number) => Math.round(lei / rate)

  // What counts: investments (+ cash and savings if chosen). Car, house and phone don't pay you a monthly income.
  const have = useMemo(() => toCur(st.assets.filter(a => !a.archived).reduce((acc, a) => {
    const sec = kindOf(a.kind).section
    return sec === 'invest' || (sec === 'liquid' && s.fi_include_liquid !== false) ? acc + toRon(a.value, a.currency, st.rates) : acc
  }, 0)), [st.assets, st.rates, s.fi_include_liquid, rate])

  // Real life from the app: average monthly spending and what's left over in the last 3 months.
  const since = new Date(Date.now() - 91 * 864e5).toISOString().slice(0, 10)
  const recent = st.txs.filter(t => t.date >= since && t.date <= today)
  const spend = toCur(Math.round(recent.filter(t => t.kind === 'out').reduce((a, t) => a + t.amount, 0) / 3))
  const income = toCur(Math.round(recent.filter(t => t.kind === 'in').reduce((a, t) => a + t.amount, 0) / 3))

  const [monthly, setMonthly] = useState<number | null>(null)
  const [ret, setRet] = useState<number | null>(null)
  const m = monthly ?? s.fi_monthly ?? 10000
  const r = ret ?? s.fi_return ?? 7

  if (!s.fi_target) {
    return (
      <section className="card fi-card">
        <div className="eyebrow"><Flag size={14} /> Independența financiară</div>
        <p className="fi-intro">Suma care îți aduce lunar destui bani încât să nu mai depinzi de salariu. Pune-ți ținta și vezi când ajungi.</p>
        {spend > 0 && <p className="note">La cheltuielile tale de acum (~{fmtNum(spend).replace(/,\d\d$/, '')} {sym}/lună) ai avea nevoie de ~<b>{fmtNum(potForSpending(spend)).replace(/,\d\d$/, '')} {sym}</b>.</p>}
        <button type="button" className="primary" onClick={() => setEdit(true)}>Setează ținta</button>
        {edit && <FiSheet onClose={() => setEdit(false)} suggested={spend ? potForSpending(spend) : null} />}
      </section>
    )
  }

  const target = s.fi_target
  const left = Math.max(0, target - have)
  const pct = Math.min(100, Math.round((have / target) * 1000) / 10)
  const months = monthsToTarget(have, m * 100 / 100, r, target)
  const pays = safeMonthly(target)
  const enough = spend ? pays >= spend : null
  const save = async (p: Partial<typeof s>) => { try { await st.saveSettings(p) } catch { /* shown next load */ } }

  return (
    <section className="card fi-card">
      <div className="fi-head">
        <div className="eyebrow"><Flag size={14} /> Independența financiară</div>
        <button type="button" className="icon-btn" aria-label="Modifică ținta" onClick={() => setEdit(true)}><Pencil size={15} /></button>
      </div>
      <div className="fi-table">
        <div><span>Ținta</span><b className="num">{fmtNum(target).replace(/,\d\d$/, '')} {sym}</b></div>
        <div><span>Ai acum</span><b className="num in">{fmtNum(have).replace(/,\d\d$/, '')} {sym}</b></div>
        <div><span>Mai ai nevoie</span><b className="num">{fmtNum(left).replace(/,\d\d$/, '')} {sym}</b></div>
        <div><span>Progres</span><b className="num">{String(pct).replace('.', ',')}%</b></div>
      </div>
      <div className="fi-bar"><i style={{ width: Math.max(1, pct) + '%' }} /></div>

      <div className="fi-calc">
        <div className="field">Pui pe lună</div>
        <div className="chips">
          {STEPS.map(v => <button key={v} type="button" className="chip" aria-pressed={m === v * 100} onClick={() => { setMonthly(v * 100); save({ fi_monthly: v * 100 }) }}>{v.toLocaleString('ro-RO')} {sym}</button>)}
        </div>
        <div className="field">Randament presupus pe an</div>
        <div className="chips">
          {RETURNS.map(v => <button key={v} type="button" className="chip" aria-pressed={r === v} onClick={() => { setRet(v); save({ fi_return: v }) }}>{v}%{v === 7 ? ' (prudent)' : v === 10 ? ' (optimist)' : ' (sigur)'}</button>)}
        </div>
        <div className="fi-when">
          {months === 0 ? <b className="in">Ai ajuns! 🎉</b>
            : months === null ? <span>Cu suma asta nu ajungi. Mărește suma pe lună.</span>
            : <>Ajungi în <b>{months >= 12 ? `${Math.floor(months / 12)} ani${months % 12 ? ` și ${months % 12} luni` : ''}` : `${months} luni`}</b>, prin <b>{addMonthsLabel(today, months)}</b></>}
        </div>
      </div>

      <div className="fi-facts">
        <p>🎯 {fmtNum(target).replace(/,\d\d$/, '')} {sym} îți pot plăti ~<b>{fmtNum(pays).replace(/,\d\d$/, '')} {sym}/lună</b> pe viață (regula de 4%).</p>
        {spend > 0 && <p>{enough ? '✅' : '⚠️'} Cheltui acum ~<b>{fmtNum(spend).replace(/,\d\d$/, '')} {sym}/lună</b>{enough ? ', deci ținta îți acoperă cheltuielile.' : `, deci ai avea nevoie de ~${fmtNum(potForSpending(spend)).replace(/,\d\d$/, '')} ${sym}.`}</p>}
        {income > 0 && <p>💶 În ultimele 3 luni ți-au rămas în medie <b>{fmtNum(Math.max(0, income - spend)).replace(/,\d\d$/, '')} {sym}/lună</b>{income - spend >= m ? ', deci suma aleasă e realistă.' : ', mai puțin decât suma aleasă.'}</p>}
      </div>
      {edit && <FiSheet onClose={() => setEdit(false)} suggested={spend ? potForSpending(spend) : null} />}
    </section>
  )
}

function FiSheet({ onClose, suggested }: { onClose: () => void; suggested: number | null }) {
  const st = useStore()
  const s = st.settings
  const [cur, setCur] = useState<'EUR' | 'RON'>(s.fi_currency || 'EUR')
  const [target, setTarget] = useState(s.fi_target ? fmtNum(s.fi_target) : '300.000')
  const [liquid, setLiquid] = useState(s.fi_include_liquid !== false)
  const [err, setErr] = useState('')
  async function save() {
    const t = parseMoney(target)
    if (!t || t <= 0) return setErr('Scrie ținta (ex. 300.000).')
    try { await st.saveSettings({ fi_target: t, fi_currency: cur, fi_include_liquid: liquid }); onClose() }
    catch (e: any) { setErr(e?.message || 'Nu s-a putut salva.') }
  }
  return (
    <Sheet title="Ținta de independență" onClose={onClose}>
      <Seg label="Moneda" value={cur} onChange={setCur} options={[{ id: 'EUR', label: 'Euro' }, { id: 'RON', label: 'Lei' }]} />
      <MoneyField id="fi-target" big value={target} onChange={setTarget} suffix={cur === 'EUR' ? '€' : 'lei'} autoFocus />
      {suggested ? <p className="hint">După cheltuielile tale de acum, suma care le acoperă e ~{fmtNum(suggested).replace(/,\d\d$/, '')} {s.fi_currency === 'RON' ? 'lei' : '€'} (cheltuieli × 12 × 25).</p> : null}
      <label className="switch">Socotesc și banii din conturi / economii<input id="fi-liquid" type="checkbox" checked={liquid} onChange={e => setLiquid(e.target.checked)} /></label>
      <p className="hint">Mașina, casa și telefonul nu se pun: nu îți aduc bani lunar. Se socotesc investițiile{liquid ? ' și banii din conturi' : ''}.</p>
      {err && <p className="err">{err}</p>}
      <div className="actions">
        {s.fi_target ? <button type="button" className="ghost-btn" onClick={async () => { await st.saveSettings({ fi_target: null }); onClose() }}>Scoate ținta</button> : null}
        <button type="button" className="primary" onClick={save}>Salvează</button>
      </div>
    </Sheet>
  )
}
