// Indicators drawn on the crypto chart. Each one maps to a rule we use:
// cloud = trend, trailing stop = where the stop-loss sits, 20-bar channel = breakout level (Ciprian's speed),
// contraction = Ciprian's squeeze, signals = bars where our rules said "buy" / "get out".
import type { Candle } from './cryptoRadar.ts'

export function emaSeries(c: number[], n: number): number[] {
  const k = 2 / (n + 1), out: number[] = []
  c.forEach((x, i) => out.push(i === 0 ? x : out[i - 1] + (x - out[i - 1]) * k))
  return out
}
export function atrSeries(cs: Candle[], n = 14): number[] {
  const out: number[] = []
  cs.forEach((x, i) => {
    const tr = i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - cs[i - 1].c), Math.abs(x.l - cs[i - 1].c))
    out.push(i === 0 ? tr : (out[i - 1] * (n - 1) + tr) / n)
  })
  return out
}

export type CloudState = 'up' | 'down' | 'mixed'
/** EMA 20 / EMA 50 and the state of the "cloud" between them. */
export function cloud(cs: Candle[]) {
  const c = cs.map(x => x.c), f = emaSeries(c, 20), s = emaSeries(c, 50)
  const state: CloudState[] = c.map((x, i) => (f[i] > s[i] && x > f[i] ? 'up' : f[i] < s[i] && x < f[i] ? 'down' : 'mixed'))
  return { fast: f, slow: s, state }
}

/** Supertrend (ATR 10 × 3): the stop that follows the price. up = hold (dots under the price), down = out. */
export function trailingStop(cs: Candle[], n = 10, mult = 3) {
  const atr = atrSeries(cs, n)
  const line: number[] = [], up: boolean[] = []
  let fu = 0, fl = 0
  cs.forEach((x, i) => {
    const mid = (x.h + x.l) / 2, bu = mid + mult * atr[i], bl = mid - mult * atr[i]
    if (i === 0) { fu = bu; fl = bl; up.push(true); line.push(bl); return }
    const pc = cs[i - 1].c
    fu = bu < fu || pc > fu ? bu : fu
    fl = bl > fl || pc < fl ? bl : fl
    let u = up[i - 1]
    if (u && x.c < fl) u = false
    else if (!u && x.c > fu) u = true
    up.push(u); line.push(u ? fl : fu)
  })
  return { line, up }
}

/** Highest high / lowest low of the previous n bars (the breakout and support steps). */
export function channel(cs: Candle[], n = 20) {
  const hi: (number | null)[] = [], lo: (number | null)[] = []
  cs.forEach((_, i) => {
    if (i < n) { hi.push(null); lo.push(null); return }
    const w = cs.slice(i - n, i)
    hi.push(Math.max(...w.map(x => x.h))); lo.push(Math.min(...w.map(x => x.l)))
  })
  return { hi, lo }
}

/** The latest squeeze: the last `n` bars move in a band much narrower than usual. */
export function contraction(cs: Candle[], n = 12): { hi: number; lo: number; from: number; widthPct: number } | null {
  if (cs.length < 80) return null
  const atr = atrSeries(cs, 14)
  const w = cs.slice(-n), hi = Math.max(...w.map(x => x.h)), lo = Math.min(...w.map(x => x.l))
  const typical = atr.slice(-60).reduce((a, x) => a + x, 0) / 60
  const narrow = hi - lo < 4 * typical && atr[atr.length - 1] < typical
  return narrow ? { hi, lo, from: w[0].t, widthPct: ((hi - lo) / lo) * 100 } : null
}

/** Nearest resistance above the price: the highest pivot high of the last 120 bars that the price is still under. */
export function resistance(cs: Candle[]): number | null {
  const p = cs[cs.length - 1].c
  const piv: number[] = []
  for (let i = Math.max(2, cs.length - 120); i < cs.length - 2; i++) {
    const h = cs[i].h
    if (h > cs[i - 1].h && h > cs[i - 2].h && h > cs[i + 1].h && h > cs[i + 2].h && h > p) piv.push(h)
  }
  return piv.length ? Math.min(...piv) : null
}

export interface Signal { t: number; kind: 'buy' | 'exit'; text: string }
/** Bars where our rules fired: breakout over the 20-bar high, cloud up, heavy volume → buy; trailing stop flips → exit. */
export function signals(cs: Candle[]): Signal[] {
  const cl = cloud(cs), ch = channel(cs), ts = trailingStop(cs)
  const out: Signal[] = []
  cs.forEach((x, i) => {
    if (i < 21) return
    const vAvg = cs.slice(i - 20, i).reduce((a, y) => a + y.v, 0) / 20
    const brk = ch.hi[i] != null && x.c > (ch.hi[i] as number) && cs[i - 1].c <= (ch.hi[i - 1] ?? Infinity)
    if (brk && cl.state[i] === 'up' && x.v > 1.5 * vAvg) out.push({ t: x.t, kind: 'buy', text: 'spargere' })
    if (ts.up[i - 1] && !ts.up[i]) out.push({ t: x.t, kind: 'exit', text: 'ieșire' })
  })
  return out
}

/** Plain-language reading of every indicator on the last bar. */
export function readout(cs: Candle[]): string[] {
  const p = cs[cs.length - 1].c, cl = cloud(cs), ts = trailingStop(cs), ch = channel(cs)
  const last = cs.length - 1
  let streak = 1
  while (streak < last && cl.state[last - streak] === cl.state[last]) streak++
  const fmt = (x: number) => (x >= 1000 ? x.toLocaleString('ro-RO', { maximumFractionDigits: 0 }) : x.toLocaleString('ro-RO', { maximumSignificantDigits: 5 }))
  const out: string[] = []
  out.push(cl.state[last] === 'up' ? `Norul e verde de ${streak} bare: tendință în sus.` : cl.state[last] === 'down' ? `Norul e roșu de ${streak} bare: tendință în jos.` : `Norul e portocaliu: tendința nu e hotărâtă (de ${streak} bare).`)
  out.push(ts.up[last] ? `Stop-ul care urcă e la ${fmt(ts.line[last])} (${(((ts.line[last] - p) / p) * 100).toFixed(1).replace('.', ',')}%): cât timp prețul e deasupra, rămâi.` : `Stop-ul a fost atins: semnal de ieșire. Revine în sus peste ${fmt(ts.line[last])}.`)
  const hi = ch.hi[last], lo = ch.lo[last]
  if (hi != null && lo != null) out.push(p > hi ? `A spart maximul ultimelor 20 de bare (${fmt(hi)}).` : `Nivelul de spargere: ${fmt(hi)} (${(((hi - p) / p) * 100).toFixed(1).replace('.', ',')}% mai sus). Suport: ${fmt(lo)}.`)
  const sq = contraction(cs)
  if (sq) out.push(`Contracție: ultimele 12 bare stau între ${fmt(sq.lo)} și ${fmt(sq.hi)} (${sq.widthPct.toFixed(1).replace('.', ',')}%). Se strânge înainte de o mișcare.`)
  const r = resistance(cs)
  if (r) out.push(`Rezistența cea mai apropiată: ${fmt(r)}.`)
  const vAvg = cs.slice(-21, -1).reduce((a, y) => a + y.v, 0) / 20
  const vx = cs[last].v / (vAvg || 1)
  out.push(vx > 1.5 ? `Volum mare pe bara curentă (${vx.toFixed(1).replace('.', ',')}× media).` : `Volum ${vx < 0.7 ? 'mic' : 'obișnuit'} pe bara curentă.`)
  return out
}
