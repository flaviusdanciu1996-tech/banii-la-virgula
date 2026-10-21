// Taxes on investment income for the Romanian "Declarația unică" (due 25 May of the following year).
// All the rules live in FISCAL_RULES so a law change is one edit. Money in bani. Pure functions.

import type { CryptoTx } from './crypto.ts'
import { toLei } from './crypto.ts'

export interface FiscalRules {
  year: number
  minWage: number // bani — minimum gross wage in force on 1 January of the income year (used for the CASS/CAS steps)
  cassRate: number
  cassSteps: number[] // in minimum wages
  casRate: number
  casSteps: number[] // in minimum wages (independent activities only)
  divRate: number // dividends, withheld at payment
  bvbLong: number // capital gains via a Romanian broker, held ≥ 365 days (withheld, final)
  bvbShort: number // held < 365 days
  cryptoRate: number // crypto gains, paid by you through the declaration
  foreignRate: number // gains via a foreign broker, paid by you
  interestRate: number // bank interest, withheld
  rentRate: number // on rent after the 20% flat deduction
  cryptoExempt: { perTx: number; perYear: number } // bani
  estimated?: boolean // rules not final yet (future year)
}

const base = { cassRate: 0.1, cassSteps: [6, 12, 24], casRate: 0.25, casSteps: [12, 24], cryptoExempt: { perTx: 20000, perYear: 60000 }, rentRate: 0.1 }
export const FISCAL_RULES: Record<number, FiscalRules> = {
  2024: { ...base, year: 2024, minWage: 330000, divRate: 0.08, bvbLong: 0.01, bvbShort: 0.03, cryptoRate: 0.1, foreignRate: 0.1, interestRate: 0.1 },
  2025: { ...base, year: 2025, minWage: 405000, divRate: 0.1, bvbLong: 0.01, bvbShort: 0.03, cryptoRate: 0.1, foreignRate: 0.1, interestRate: 0.1 },
  2026: { ...base, year: 2026, minWage: 405000, divRate: 0.16, bvbLong: 0.03, bvbShort: 0.06, cryptoRate: 0.16, foreignRate: 0.16, interestRate: 0.1 },
  2027: { ...base, year: 2027, minWage: 432500, divRate: 0.16, bvbLong: 0.03, bvbShort: 0.06, cryptoRate: 0.16, foreignRate: 0.16, interestRate: 0.1, estimated: true },
}
export const RULES_CHECKED = '21.10.2026'
export function rulesFor(year: number): FiscalRules {
  if (FISCAL_RULES[year]) return FISCAL_RULES[year]
  const years = Object.keys(FISCAL_RULES).map(Number).sort((a, b) => a - b)
  const last = FISCAL_RULES[years[years.length - 1]]
  return { ...(year < years[0] ? FISCAL_RULES[years[0]] : last), year, estimated: true }
}

/* ---------- Inputs ---------- */

/** Tradeville rows as stored (invest_tx). net/commission/profit in bani, qty in shares (or lei for dividends). */
export interface BrokerRow { at: string; op: string; symbol: string; qty: number; price: number | null; commission: number; net: number; profit: number | null; note: string }
export type ManualKind = 'srl_div' | 'interest' | 'rent' | 'independent' | 'foreign_gain' | 'other'
export interface ManualIncome { id?: string; kind: ManualKind; amount: number; tax_withheld: number; day: string; note: string }

export const MANUAL_LABEL: Record<ManualKind, string> = {
  srl_div: 'Dividende de la firma ta (SRL)', interest: 'Dobânzi bancare', rent: 'Chirii', independent: 'PFA / drepturi de autor (venit net)',
  foreign_gain: 'Câștig la un broker din străinătate (net pe an)', other: 'Alt venit din investiții',
}

/* ---------- Output ---------- */

export interface FiscalLine {
  key: string
  label: string
  gross: number // what counts as income (bani)
  withheld: number // tax already paid at source
  toPay: number // tax you pay through the declaration
  cassBase: number // what counts toward the CASS steps
  casBase: number
  note?: string
  estimated?: boolean
  details?: { day: string; text: string; amount: number }[]
}
export interface Step { mult: number; at: number; due: number }
export interface FiscalReport {
  year: number
  rules: FiscalRules
  lines: FiscalLine[]
  withheld: number
  taxToPay: number
  cassBase: number
  cassStep: Step | null // the step you're in (null = under 6 minimum wages)
  cassDue: number
  cassNext: (Step & { left: number }) | null
  casBase: number
  casStep: Step | null
  casDue: number
  totalToPay: number // tax + CASS + CAS through the declaration
  deadline: string // 25 May of the next year
  notes: string[]
}

const yearOf = (iso: string) => Number(iso.slice(0, 4))

/** Shares bought before a sale (first in, first out): share of the sold quantity held ≥ 365 days. */
function heldLongShare(rows: BrokerRow[], sale: BrokerRow): number {
  const lots: { at: string; qty: number }[] = []
  for (const r of [...rows].sort((a, b) => a.at.localeCompare(b.at))) {
    if (r.symbol !== sale.symbol || r.at > sale.at) continue
    if (r === sale) break
    if (r.op === 'cump' || (r.op === 'in' && r.symbol !== 'RON')) lots.push({ at: r.at, qty: r.qty })
    else if (r.op === 'vanz' || (r.op === 'out' && r.symbol !== 'RON')) {
      let q = r.qty
      while (q > 1e-9 && lots.length) { const l = lots[0]; const d = Math.min(l.qty, q); l.qty -= d; q -= d; if (l.qty <= 1e-9) lots.shift() }
    }
  }
  let q = sale.qty, long = 0
  const limit = new Date(Date.parse(sale.at) - 365 * 864e5).toISOString()
  for (const l of lots) { if (q <= 1e-9) break; const d = Math.min(l.qty, q); if (l.at <= limit) long += d; q -= d }
  return sale.qty > 0 ? long / sale.qty : 0
}

/** Crypto sells of a year with their gain in bani (average cost, fees included). */
export function cryptoGains(txs: CryptoTx[], year: number): { day: string; coin: string; gain: number }[] {
  const st = new Map<string, { qty: number; cost: number }>()
  const out: { day: string; coin: string; gain: number }[] = []
  for (const t of [...txs].sort((a, b) => (a.at < b.at ? -1 : 1))) {
    const p = st.get(t.coin) ?? { qty: 0, cost: 0 }
    const fee = toLei(t, t.fee || 0)
    if (t.kind === 'buy') { p.qty += t.qty; p.cost += toLei(t, (t.price ?? 0) * t.qty) + fee }
    else if (t.kind === 'sell') {
      const avg = p.qty > 1e-12 ? p.cost / p.qty : 0, sold = Math.min(t.qty, p.qty)
      const gain = toLei(t, (t.price ?? 0) * t.qty) - fee - avg * sold
      p.cost -= avg * sold; p.qty -= t.qty
      if (yearOf(t.at) === year) out.push({ day: t.at.slice(0, 10), coin: t.coin, gain: Math.round(gain * 100) })
    } else p.qty += t.qty
    if (p.qty <= 1e-12) { p.qty = 0; p.cost = 0 }
    st.set(t.coin, p)
  }
  return out
}

/** The step reached for a base (in bani) — CASS/CAS are a fixed % of the step, not of the income. */
export function stepFor(baseAmount: number, steps: number[], minWage: number, rate: number): { step: Step | null; next: (Step & { left: number }) | null } {
  const all = steps.map(m => ({ mult: m, at: m * minWage, due: Math.round(m * minWage * rate) }))
  let step: Step | null = null
  for (const s of all) if (baseAmount >= s.at) step = s
  const n = all.find(s => baseAmount < s.at) ?? null
  return { step, next: n ? { ...n, left: n.at - baseAmount } : null }
}

export function fiscalReport(year: number, broker: BrokerRow[], crypto: CryptoTx[], manual: ManualIncome[]): FiscalReport {
  const R = rulesFor(year)
  const lines: FiscalLine[] = []
  const notes: string[] = []

  // 1) Shares sold through Tradeville: tax withheld by the broker (final), the net gain counts for CASS.
  const sales = broker.filter(r => r.op === 'vanz' && yearOf(r.at) === year && r.profit != null)
  if (sales.length) {
    let gain = 0, withheld = 0
    const details = sales.map(s => {
      const longShare = heldLongShare(broker, s)
      const rate = longShare * R.bvbLong + (1 - longShare) * R.bvbShort
      const tax = s.profit! > 0 ? Math.round(s.profit! * rate) : 0
      gain += s.profit!; withheld += tax
      return { day: s.at.slice(0, 10), text: `${s.symbol} · ${Math.round(s.qty * 1000) / 1000} acț. · ${longShare >= 0.999 ? 'ținute peste 1 an' : longShare <= 0.001 ? 'ținute sub 1 an' : 'parțial peste 1 an'}`, amount: s.profit! }
    })
    lines.push({ key: 'bvb_gain', label: 'Câștiguri din acțiuni (Tradeville)', gross: gain, withheld, toPay: 0, cassBase: Math.max(0, gain), casBase: 0, estimated: true,
      note: `Impozitul (${pct(R.bvbLong)} peste 1 an, ${pct(R.bvbShort)} sub 1 an) îl reține Tradeville. Pierderile nu se reportează. Suma exactă e în fișa anuală Tradeville.`, details })
  }

  // 2) BVB dividends: Tradeville shows what reached the account (after the withheld tax) → gross estimated back.
  const divs = broker.filter(r => r.op === 'div' && yearOf(r.at) === year)
  if (divs.length) {
    let gross = 0, withheld = 0
    const details = divs.map(d => {
      const received = Math.round(d.qty * 100) // lei credited before the broker's fee
      const g = Math.round(received / (1 - R.divRate))
      gross += g; withheld += g - received
      return { day: d.at.slice(0, 10), text: d.note || 'dividend', amount: g }
    })
    lines.push({ key: 'bvb_div', label: 'Dividende de la acțiunile BVB', gross, withheld, toPay: 0, cassBase: gross, casBase: 0, estimated: true,
      note: `Impozit ${pct(R.divRate)}, reținut la plată. Brutul e estimat din ce a intrat în cont.`, details })
  }

  // 3) Crypto: you pay the tax yourself; small gains are exempt only if every sale < 200 lei AND the year ≤ 600 lei.
  const cg = cryptoGains(crypto, year)
  if (cg.length) {
    const net = cg.reduce((a, x) => a + x.gain, 0)
    const exempt = cg.every(x => x.gain < R.cryptoExempt.perTx) && net <= R.cryptoExempt.perYear
    const taxable = exempt ? 0 : Math.max(0, net)
    lines.push({ key: 'crypto', label: 'Câștiguri din crypto', gross: net, withheld: 0, toPay: Math.round(taxable * R.cryptoRate), cassBase: taxable, casBase: 0,
      note: exempt ? 'Scutit: fiecare vânzare sub 200 lei și totalul pe an sub 600 lei.' : net <= 0 ? 'Pierdere pe an: nu datorezi impozit. Pierderea nu se reportează.' : `Impozit ${pct(R.cryptoRate)} din câștigul net pe an, plătit de tine prin declarație.`,
      details: cg.map(x => ({ day: x.day, text: `vânzare ${x.coin}`, amount: x.gain })) })
  }

  // 4) What you add by hand.
  const mine = manual.filter(m => yearOf(m.day) === year)
  const byKind = new Map<ManualKind, ManualIncome[]>()
  for (const m of mine) byKind.set(m.kind, [...(byKind.get(m.kind) ?? []), m])
  for (const [kind, list] of byKind) {
    const gross = list.reduce((a, m) => a + m.amount, 0), withheld = list.reduce((a, m) => a + m.tax_withheld, 0)
    const details = list.map(m => ({ day: m.day, text: m.note || MANUAL_LABEL[kind], amount: m.amount }))
    if (kind === 'srl_div') lines.push({ key: kind, label: MANUAL_LABEL[kind], gross, withheld, toPay: 0, cassBase: gross, casBase: 0, note: `Impozit ${pct(R.divRate)}, reținut și plătit de firmă (D100). Contează la CASS.`, details })
    else if (kind === 'interest') lines.push({ key: kind, label: MANUAL_LABEL[kind], gross, withheld, toPay: 0, cassBase: gross, casBase: 0, note: 'Impozitul îl reține banca. Contează la CASS.', details })
    else if (kind === 'rent') { const net = Math.round(gross * 0.8); lines.push({ key: kind, label: MANUAL_LABEL[kind], gross, withheld, toPay: Math.max(0, Math.round(net * R.rentRate) - withheld), cassBase: net, casBase: 0, note: `Venit net = 80% din chirie; impozit ${pct(R.rentRate)} din net.`, details }) }
    else if (kind === 'independent') { lines.push({ key: kind, label: MANUAL_LABEL[kind], gross, withheld, toPay: Math.max(0, Math.round(gross * 0.1) - withheld), cassBase: gross, casBase: gross, note: 'Impozit 10% din venitul net. Aici se datorează și CAS (pensie).', details }); notes.push('Ai venituri din activități independente: la ele CASS are reguli proprii (minim 6 salarii). Verifică suma cu contabilul.') }
    else if (kind === 'foreign_gain') lines.push({ key: kind, label: MANUAL_LABEL[kind], gross, withheld, toPay: Math.max(0, Math.round(Math.max(0, gross) * R.foreignRate) - withheld), cassBase: Math.max(0, gross), casBase: 0, note: `Impozit ${pct(R.foreignRate)} din câștigul net, plătit de tine. Pierderile se reportează 5 ani.`, details })
    else lines.push({ key: kind, label: MANUAL_LABEL[kind], gross, withheld, toPay: 0, cassBase: Math.max(0, gross), casBase: 0, details })
  }

  const cassBase = lines.reduce((a, l) => a + l.cassBase, 0)
  const cass = stepFor(cassBase, R.cassSteps, R.minWage, R.cassRate)
  const casBase = lines.reduce((a, l) => a + l.casBase, 0)
  const cas = stepFor(casBase, R.casSteps, R.minWage, R.casRate)
  const taxToPay = lines.reduce((a, l) => a + l.toPay, 0)
  const withheld = lines.reduce((a, l) => a + l.withheld, 0)
  if (R.estimated) notes.push(`Regulile pentru ${year} nu sunt încă finale: am folosit ce se știe acum (salariul minim ${Math.round(R.minWage / 100)} lei).`)
  return {
    year, rules: R, lines, withheld, taxToPay,
    cassBase, cassStep: cass.step, cassDue: cass.step?.due ?? 0, cassNext: cass.next,
    casBase, casStep: cas.step, casDue: cas.step?.due ?? 0,
    totalToPay: taxToPay + (cass.step?.due ?? 0) + (cas.step?.due ?? 0),
    deadline: `${year + 1}-05-25`, notes,
  }
}

/** How much to put aside each month from now until the deadline. */
export function monthlyReserve(total: number, today: string, deadline: string): { months: number; perMonth: number } {
  const [y1, m1] = today.split('-').map(Number), [y2, m2] = deadline.split('-').map(Number)
  const months = Math.max(1, (y2 - y1) * 12 + (m2 - m1))
  return { months, perMonth: Math.ceil(total / months / 100) * 100 }
}

function pct(x: number) { return `${String(Math.round(x * 1000) / 10).replace('.', ',')}%` }
