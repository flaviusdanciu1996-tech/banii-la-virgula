// Taxes on investment income for the Romanian "Declarația unică" (due 25 May of the following year).
// All the rules live in FISCAL_RULES so a law change is one edit. Money in bani. Pure functions.

import type { CryptoTx } from './crypto.ts'
import { ledger } from './crypto.ts'

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
/** Years already declared and paid (Declarația unică filed): shown as settled, nothing more to pay. */
export const DECLARED_UNTIL = 2025
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
export interface ManualIncome { id?: string; kind: ManualKind; amount: number; tax_withheld: number; day: string; note: string; platform?: string }

export const MANUAL_LABEL: Record<ManualKind, string> = {
  srl_div: 'Dividende de la firma ta (SRL)', interest: 'Dobânzi bancare', rent: 'Chirii (inclusiv mașina închiriată firmei)', independent: 'PFA / drepturi de autor (venit net)',
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
  platform?: string // where it comes from (Tradeville, Revolut, Binance, firma ta…)
  split?: { platform: string; amount: number }[] // crypto: gains per platform (taxed together)
  details?: { day: string; text: string; amount: number }[]
}
export interface Step { mult: number; at: number; due: number }
/** One income as it happened, for the month-by-month list. */
export interface FiscalEvent { day: string; source: 'rent' | 'bvb_gain' | 'dividend' | 'interest' | 'crypto' | 'other'; label: string; platform: string; gross: number; cass: number; withheld: number }
export const SOURCE_LABEL: Record<FiscalEvent['source'], string> = { rent: 'Chirii', bvb_gain: 'Acțiuni vândute', dividend: 'Dividende', interest: 'Dobânzi', crypto: 'Crypto', other: 'Altele' }
export interface FiscalReport {
  year: number
  platforms: { name: string; income: number; withheld: number; toPay: number }[] // where each leu comes from
  events: FiscalEvent[] // every income of the year, in date order
  bySource: { source: FiscalEvent['source']; cass: number }[] // what fills the CASS bar
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

/** Crypto sales of a year with their gain in bani — all wallets together, weighted-average cost, swaps not taxed. */
export function cryptoGains(txs: CryptoTx[], year: number, platformOf: (assetId?: string) => string = () => ''): { day: string; coin: string; gain: number; platform: string }[] {
  return ledger(txs).sales.filter(s => yearOf(s.at) === year).map(s => ({ day: s.at.slice(0, 10), coin: s.coin, gain: Math.round(s.gain * 100), platform: platformOf(s.asset_id) }))
}

/** The step reached for a base (in bani) — CASS/CAS are a fixed % of the step, not of the income. */
export function stepFor(baseAmount: number, steps: number[], minWage: number, rate: number): { step: Step | null; next: (Step & { left: number }) | null } {
  const all = steps.map(m => ({ mult: m, at: m * minWage, due: Math.round(m * minWage * rate) }))
  let step: Step | null = null
  for (const s of all) if (baseAmount >= s.at) step = s
  const n = all.find(s => baseAmount < s.at) ?? null
  return { step, next: n ? { ...n, left: n.at - baseAmount } : null }
}

export function fiscalReport(year: number, broker: BrokerRow[], crypto: CryptoTx[], manual: ManualIncome[], platformOf: (assetId?: string) => string = () => ''): FiscalReport {
  const R = rulesFor(year)
  const lines: FiscalLine[] = []
  const notes: string[] = []
  const events: FiscalEvent[] = []

  // 1) Shares sold through Tradeville: tax withheld by the broker (final), the net gain counts for CASS.
  const sales = broker.filter(r => r.op === 'vanz' && yearOf(r.at) === year && r.profit != null)
  if (sales.length) {
    let gain = 0, withheld = 0
    const details = sales.map(s => {
      const longShare = heldLongShare(broker, s)
      const rate = longShare * R.bvbLong + (1 - longShare) * R.bvbShort
      const tax = s.profit! > 0 ? Math.round(s.profit! * rate) : 0
      gain += s.profit!; withheld += tax
      events.push({ day: s.at.slice(0, 10), source: 'bvb_gain', label: `Vânzare ${s.symbol}`, platform: 'Tradeville', gross: s.profit!, cass: s.profit!, withheld: tax })
      return { day: s.at.slice(0, 10), text: `${s.symbol} · ${Math.round(s.qty * 1000) / 1000} acț. · ${longShare >= 0.999 ? 'ținute peste 1 an' : longShare <= 0.001 ? 'ținute sub 1 an' : 'parțial peste 1 an'}`, amount: s.profit! }
    })
    lines.push({ key: 'bvb_gain', platform: 'Tradeville', label: 'Câștiguri din acțiuni (Tradeville)', gross: gain, withheld, toPay: 0, cassBase: Math.max(0, gain), casBase: 0, estimated: true,
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
      events.push({ day: d.at.slice(0, 10), source: 'dividend', label: d.note || 'Dividend', platform: 'Tradeville', gross: g, cass: g, withheld: g - received })
      return { day: d.at.slice(0, 10), text: d.note || 'dividend', amount: g }
    })
    lines.push({ key: 'bvb_div', platform: 'Tradeville', label: 'Dividende de la acțiunile BVB (Tradeville)', gross, withheld, toPay: 0, cassBase: gross, casBase: 0, estimated: true,
      note: `Impozit ${pct(R.divRate)}, reținut la plată. Brutul e estimat din ce a intrat în cont.`, details })
  }

  // 3) Crypto: you pay the tax yourself; small gains are exempt only if every sale < 200 lei AND the year ≤ 600 lei.
  const cg = cryptoGains(crypto, year, platformOf)
  if (cg.length) {
    const net = cg.reduce((a, x) => a + x.gain, 0)
    const exempt = cg.every(x => x.gain < R.cryptoExempt.perTx) && net <= R.cryptoExempt.perYear
    const taxable = exempt ? 0 : Math.max(0, net)
    for (const x of cg) events.push({ day: x.day, source: 'crypto', label: `Vânzare ${x.coin}`, platform: x.platform, gross: x.gain, cass: exempt ? 0 : x.gain, withheld: 0 })
    const split = [...cg.reduce((m, x) => m.set(x.platform || 'Crypto', (m.get(x.platform || 'Crypto') ?? 0) + x.gain), new Map<string, number>())].map(([platform, amount]) => ({ platform, amount }))
    lines.push({ key: 'crypto', split, label: `Câștiguri din crypto${split.length ? ` (${split.map(x => x.platform).join(' + ')})` : ''}`, gross: net, withheld: 0, toPay: Math.round(taxable * R.cryptoRate), cassBase: taxable, casBase: 0,
      note: exempt ? 'Scutit: fiecare vânzare sub 200 lei și totalul pe an sub 600 lei.' : net <= 0 ? 'Pierdere pe an: nu datorezi impozit. Pierderea nu se reportează.' : `Impozit ${pct(R.cryptoRate)} din câștigul net pe an, plătit de tine prin declarație.`,
      details: cg.map(x => ({ day: x.day, text: `${x.platform ? x.platform + ' · ' : ''}vânzare ${x.coin}`, amount: x.gain })) })
  }

  // 4) What you add by hand.
  const mine = manual.filter(m => yearOf(m.day) === year)
  const byKind = new Map<string, ManualIncome[]>()
  for (const m of mine) { const k = `${m.kind}|${m.platform ?? ''}`; byKind.set(k, [...(byKind.get(k) ?? []), m]) }
  for (const [k, list] of byKind) {
    const kind = k.split('|')[0] as ManualKind, platform = k.split('|')[1] || undefined
    const before = lines.length
    const gross = list.reduce((a, m) => a + m.amount, 0), withheld = list.reduce((a, m) => a + m.tax_withheld, 0)
    const details = list.map(m => ({ day: m.day, text: m.note || MANUAL_LABEL[kind], amount: m.amount }))
    for (const m of list) events.push({ day: m.day, source: kind === 'rent' ? 'rent' : kind === 'interest' ? 'interest' : kind === 'srl_div' ? 'dividend' : 'other', label: m.note || MANUAL_LABEL[kind], platform: platform ?? '', gross: m.amount, cass: kind === 'rent' ? Math.round(m.amount * 0.8) : m.amount, withheld: m.tax_withheld })
    if (kind === 'srl_div') lines.push({ key: kind, label: MANUAL_LABEL[kind], gross, withheld, toPay: 0, cassBase: gross, casBase: 0, note: `Impozit ${pct(R.divRate)}, reținut și plătit de firmă (D100). Contează la CASS.`, details })
    else if (kind === 'interest') lines.push({ key: kind, label: MANUAL_LABEL[kind], gross, withheld, toPay: 0, cassBase: gross, casBase: 0, note: 'Impozitul îl reține banca (Revolut: 10% dacă contul e pe sucursala din România, 15% dacă e încă în Lituania). Contează la CASS.', details })
    else if (kind === 'rent') { const net = Math.round(gross * 0.8); lines.push({ key: kind, label: MANUAL_LABEL[kind], gross, withheld, toPay: Math.max(0, Math.round(net * R.rentRate) - withheld), cassBase: net, casBase: 0, note: withheld > 0 ? `Chirie plătită de o firmă: firma a reținut ${pct(R.rentRate)} din 80% (impozit final). Contează la CASS cu 80% din sumă.` : `Venit net = 80% din chirie; impozit ${pct(R.rentRate)} din net, plătit de tine.`, details }) }
    else if (kind === 'independent') { lines.push({ key: kind, label: MANUAL_LABEL[kind], gross, withheld, toPay: Math.max(0, Math.round(gross * 0.1) - withheld), cassBase: gross, casBase: gross, note: 'Impozit 10% din venitul net. Aici se datorează și CAS (pensie).', details }); notes.push('Ai venituri din activități independente: la ele CASS are reguli proprii (minim 6 salarii). Verifică suma cu contabilul.') }
    else if (kind === 'foreign_gain') lines.push({ key: kind, label: MANUAL_LABEL[kind], gross, withheld, toPay: Math.max(0, Math.round(Math.max(0, gross) * R.foreignRate) - withheld), cassBase: Math.max(0, gross), casBase: 0, note: `Impozit ${pct(R.foreignRate)} din câștigul net, plătit de tine. Pierderile se reportează 5 ani.`, details })
    else lines.push({ key: kind, label: MANUAL_LABEL[kind], gross, withheld, toPay: 0, cassBase: Math.max(0, gross), casBase: 0, details })
    for (const l of lines.slice(before)) { l.key = k; l.platform = platform; if (platform) l.label = `${l.label} · ${platform}` }
  }

  const cassBase = lines.reduce((a, l) => a + l.cassBase, 0)
  const cass = stepFor(cassBase, R.cassSteps, R.minWage, R.cassRate)
  const casBase = lines.reduce((a, l) => a + l.casBase, 0)
  const cas = stepFor(casBase, R.casSteps, R.minWage, R.casRate)
  const taxToPay = lines.reduce((a, l) => a + l.toPay, 0)
  const withheld = lines.reduce((a, l) => a + l.withheld, 0)
  if (R.estimated) notes.push(`Regulile pentru ${year} nu sunt încă finale: am folosit ce se știe acum (salariul minim ${Math.round(R.minWage / 100)} lei; contează cel în vigoare la 1 ianuarie ${year}, deci se schimbă dacă Guvernul îl mărește din ianuarie).`)
  const pm = new Map<string, { name: string; income: number; withheld: number; toPay: number }>()
  const addP = (name: string, income: number, withheld: number, toPay: number) => { const x = pm.get(name) ?? { name, income: 0, withheld: 0, toPay: 0 }; x.income += income; x.withheld += withheld; x.toPay += toPay; pm.set(name, x) }
  for (const l of lines) {
    if (l.split?.length) { const pos = l.split.reduce((a, x) => a + Math.max(0, x.amount), 0); for (const x of l.split) addP(x.platform, x.amount, 0, pos > 0 ? Math.round((l.toPay * Math.max(0, x.amount)) / pos) : 0) }
    else addP(l.platform || (l.key.startsWith('srl_div') ? 'Firma ta' : 'Altele'), l.gross, l.withheld, l.toPay)
  }
  events.sort((a, b) => a.day.localeCompare(b.day))
  const srcMap = new Map<FiscalEvent['source'], number>()
  for (const l of lines) {
    const src: FiscalEvent['source'] = l.key.startsWith('rent') ? 'rent' : l.key === 'bvb_gain' ? 'bvb_gain' : l.key === 'bvb_div' || l.key.startsWith('srl_div') ? 'dividend' : l.key.startsWith('interest') ? 'interest' : l.key === 'crypto' ? 'crypto' : 'other'
    srcMap.set(src, (srcMap.get(src) ?? 0) + l.cassBase)
  }
  return {
    year, platforms: [...pm.values()], events, bySource: [...srcMap].map(([source, cass]) => ({ source, cass })).filter(x => x.cass !== 0).sort((a, b) => b.cass - a.cass), rules: R, lines, withheld, taxToPay,
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
