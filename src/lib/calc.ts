import type { Category, Tx, Settings, Asset, Snapshot, AssetSection } from './types.ts'
import { kindOf } from './types.ts'
import { type Period, inPeriod, daysElapsed, daysLeft, periodLength, addDays, diffDays } from './period.ts'
import { toRon, pct } from './money.ts'

export interface PeriodSummary {
  income: number
  spent: number // expenses excluding the Economii group
  saved: number // Economii group, without investments
  invested: number // investment categories (funds, pension, stocks, crypto)
  byCat: Map<string, number>
  totalBudget: number
  left: number // totalBudget - spent
  spentPct: number // of total budget
  elapsedPct: number // of period days
  daysLeft: number
  txs: Tx[]
}

/** Investments are kept apart from savings so the two are never mixed. */
export const isInvestCat = (c: { name: string }) => /investi|pensi|bursa|bursă|crypto|actiuni|acțiuni|fond/i.test(c.name) && !/urgen/i.test(c.name)

export function totalBudget(cats: Category[], s: Settings | null): number {
  if (s?.total_budget && s.total_budget > 0) return s.total_budget
  return cats.filter(c => c.kind === 'out' && !c.archived && c.grp !== 'economii').reduce((a, c) => a + (c.allocated || 0), 0)
}

export function summarize(txs: Tx[], cats: Category[], s: Settings | null, p: Period, today: string): PeriodSummary {
  const catById = new Map(cats.map(c => [c.id, c]))
  const list = txs.filter(t => inPeriod(t.date, p))
  let income = 0, spent = 0, saved = 0, invested = 0
  const byCat = new Map<string, number>()
  for (const t of list) {
    if (t.kind === 'in') { income += t.amount; continue }
    byCat.set(t.category_id, (byCat.get(t.category_id) || 0) + t.amount)
    const c = catById.get(t.category_id)
    if (c?.grp === 'economii' && isInvestCat(c)) invested += t.amount
    else if (c?.grp === 'economii') saved += t.amount
    else spent += t.amount
  }
  const tb = totalBudget(cats, s)
  return {
    income, spent, saved, invested, byCat,
    totalBudget: tb,
    left: tb - spent,
    spentPct: tb ? Math.round((spent / tb) * 100) : 0,
    elapsedPct: Math.round((daysElapsed(p, today) / periodLength(p)) * 100),
    daysLeft: daysLeft(p, today),
    txs: list,
  }
}

/* ---------- Net worth ---------- */

export interface NetWorth {
  liquid: number; invest: number; goods: number; debts: number; net: number
  invested: number; investValue: number // investments only, RON
}

export function netWorth(assets: Asset[], rates: { EUR: number; USD: number }): NetWorth {
  const r: NetWorth = { liquid: 0, invest: 0, goods: 0, debts: 0, net: 0, invested: 0, investValue: 0 }
  for (const a of assets) {
    if (a.archived) continue
    const sec: AssetSection = kindOf(a.kind).section
    const v = toRon(a.value, a.currency, rates)
    if (sec === 'liquid') r.liquid += v
    else if (sec === 'invest') { r.invest += v; r.investValue += v; r.invested += toRon(a.invested || 0, a.currency, rates) }
    else if (sec === 'goods') r.goods += v
    else r.debts += v
  }
  r.net = r.liquid + r.invest + r.goods - r.debts
  return r
}

/** Snapshot value of net worth on or before `day` (latest snapshot not after it). */
export function snapshotAt(snaps: Snapshot[], day: string): Snapshot | null {
  let best: Snapshot | null = null
  for (const s of snaps) if (s.day <= day && (!best || s.day > best.day)) best = s
  return best
}

/** Last snapshot of each of the last `n` months, oldest first. */
export function monthlySeries(snaps: Snapshot[], today: string, n = 12): { label: string; value: number | null; day: string }[] {
  const out: { label: string; value: number | null; day: string }[] = []
  const [y, m] = today.split('-').map(Number)
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i + 1, 0)) // last day of that month
    const end = d.toISOString().slice(0, 10)
    const cap = end > today ? today : end
    const s = snapshotAt(snaps, cap)
    out.push({ label: end.slice(0, 7), value: s ? s.net : null, day: cap })
  }
  return out
}

/* ---------- Streak & points ---------- */

export function recordDays(txs: Tx[], memberId: string): string[] {
  const set = new Set<string>()
  for (const t of txs) if (t.member_id === memberId) set.add(localDay(t.created_at))
  return [...set].sort()
}

export function localDay(ts: string): string {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ts.slice(0, 10)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function streak(days: string[], today: string): number {
  const set = new Set(days)
  let cur = set.has(today) ? today : addDays(today, -1)
  let n = 0
  while (set.has(cur)) { n++; cur = addDays(cur, -1) }
  return n
}

export function points(txs: Tx[], memberId: string): number {
  const perDay = new Map<string, number>()
  for (const t of txs) if (t.member_id === memberId) {
    const d = localDay(t.created_at)
    perDay.set(d, (perDay.get(d) || 0) + 1)
  }
  const days = [...perDay.keys()].sort()
  let total = 0, run = 0, prev = ''
  for (const d of days) {
    total += Math.min(5, perDay.get(d)!)
    run = prev && diffDays(prev, d) === 1 ? run + 1 : 1
    if (run % 7 === 0) total += 10
    prev = d
  }
  return total
}

/* ---------- Savings rate ---------- */

export function savingsRate(income: number, spent: number): number | null {
  if (income <= 0) return null
  return Math.round(((income - spent) / income) * 1000) / 10
}

/* ---------- Rule-based recommendations ---------- */

export interface Reco { tone: 'bad' | 'warn' | 'good' | 'info'; title: string; text: string }

export function recommendations(
  cur: PeriodSummary, prev: PeriodSummary, cats: Category[], s: Settings | null,
  fmt: (n: number) => string,
): Reco[] {
  const out: Reco[] = []
  const catById = new Map(cats.map(c => [c.id, c]))
  const outCats = cats.filter(c => c.kind === 'out' && !c.archived && c.grp !== 'economii')

  if (!cur.txs.length) {
    return [{ tone: 'info', title: 'Încă nu sunt date', text: 'Trece veniturile și cheltuielile perioadei, iar aici apar sfaturi calculate din cifrele tale.' }]
  }
  if (cur.income === 0) out.push({ tone: 'info', title: 'Lipsește venitul', text: 'N-ai trecut niciun venit în perioada asta. Fără el nu pot calcula cât economisești.' })

  // Over budget categories
  for (const c of outCats) {
    const sp = cur.byCat.get(c.id) || 0
    if (c.allocated > 0 && sp > c.allocated) {
      out.push({ tone: 'bad', title: `${c.name}: peste limită`, text: `Ai cheltuit ${fmt(sp)} din ${fmt(c.allocated)} alocați, cu ${fmt(sp - c.allocated)} peste. Fie tai din altă categorie, fie mărești limita realist pentru luna viitoare.` })
    } else if (c.allocated > 0 && cur.elapsedPct < 100 && sp / c.allocated > Math.min(1, (cur.elapsedPct + 15) / 100) && sp <= c.allocated) {
      const daily = cur.daysLeft > 0 ? Math.floor((c.allocated - sp) / cur.daysLeft) : 0
      out.push({ tone: 'warn', title: `${c.name}: merge prea repede`, text: `Ai folosit ${pct(sp, c.allocated)}% din limită, dar a trecut doar ${cur.elapsedPct}% din perioadă. Ca să te încadrezi: maxim ${fmt(daily)} pe zi de acum.` })
    }
  }

  // Keep only the 3 fastest-burning categories so the list stays readable
  const fast = out.filter(r => r.title.endsWith('merge prea repede'))
  if (fast.length > 3) {
    const keep = new Set(fast.map(r => ({ r, p: Number(r.text.match(/folosit (\d+)%/)?.[1] || 0) })).sort((a, b) => b.p - a.p).slice(0, 3).map(x => x.r))
    for (let i = out.length - 1; i >= 0; i--) if (fast.includes(out[i]) && !keep.has(out[i])) out.splice(i, 1)
  }

  // Overall pace
  if (cur.totalBudget > 0 && cur.elapsedPct < 100 && cur.spentPct > cur.elapsedPct + 10) {
    const daily = cur.daysLeft > 0 ? Math.max(0, Math.floor(cur.left / cur.daysLeft)) : 0
    out.push({ tone: 'warn', title: 'Ritmul general e prea alert', text: `Ai cheltuit ${cur.spentPct}% din buget în ${cur.elapsedPct}% din perioadă. Ca să termini pe plus, ai cel mult ${fmt(daily)} pe zi în următoarele ${cur.daysLeft} zile.` })
  }

  // Spending without a limit
  const unlimited = outCats.filter(c => !c.allocated && (cur.byCat.get(c.id) || 0) > 0)
  if (unlimited.length) {
    const top = unlimited.sort((a, b) => (cur.byCat.get(b.id) || 0) - (cur.byCat.get(a.id) || 0)).slice(0, 3)
    out.push({ tone: 'info', title: 'Categorii fără limită', text: `Cheltui în ${top.map(c => `${c.name} (${fmt(cur.byCat.get(c.id) || 0)})`).join(', ')} fără o limită setată. Pune-le o limită în Finanțe ca să le poți urmări.` })
  }

  // Biggest increase vs previous period
  let worst: { c: string; d: number } | null = null
  for (const [id, v] of cur.byCat) {
    const c = catById.get(id); if (!c || c.grp === 'economii') continue
    const d = v - (prev.byCat.get(id) || 0)
    if (d > 0 && (!worst || d > worst.d)) worst = { c: id, d }
  }
  if (worst && prev.txs.length && worst.d > 0) {
    const c = catById.get(worst.c)!
    out.push({ tone: 'info', title: `Cea mai mare creștere: ${c.name}`, text: `Ai cheltuit cu ${fmt(worst.d)} mai mult decât în perioada trecută. Verifică dacă a fost ceva excepțional sau devine un obicei.` })
  }

  // Savings rate vs target
  const target = s?.savings_target_pct ?? 20
  const rate = savingsRate(cur.income, cur.spent)
  const rs = rate === null ? '' : String(rate).replace('.', ',')
  if (rate !== null) {
    if (rate >= target) out.push({ tone: 'good', title: 'Economisești peste țintă', text: `Rata ta de economisire e ${rs}%, peste ținta de ${target}%. Mută surplusul în Economii sau Investiții ca să nu se topească.` })
    else {
      const need = Math.ceil(cur.income * (target / 100)) - (cur.income - cur.spent)
      out.push({ tone: rate < 0 ? 'bad' : 'warn', title: 'Sub ținta de economisire', text: `Rata ta e ${rs}%, ținta e ${target}%. Ca s-o atingi îți lipsesc ${fmt(Math.max(0, need))}; cel mai ușor tai din categoriile opționale.` })
    }
  }

  if (!out.length) out.push({ tone: 'good', title: 'Totul e în grafic', text: 'Nicio categorie nu e peste limită și ritmul cheltuielilor e sănătos. Continuă așa.' })
  const order = { bad: 0, warn: 1, info: 2, good: 3 }
  return out.sort((a, b) => order[a.tone] - order[b.tone])
}
