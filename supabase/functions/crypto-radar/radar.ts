// Crypto radar: our rules (Ciprian: trend, contraction, speed; books: Minervini, golden cross, ADX, EMA 5/8/13, MACD, RSI)
// applied to Binance daily candles, with a concrete plan: where to buy, stop-loss, target.
// Pure functions, no imports: also deployed with the `crypto-radar` edge function.

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
export type Zone = 'buy' | 'wait' | 'watch' | 'avoid'
export interface Rule { id: string; label: string; ok: boolean; detail: string }
export type Dir = 'up' | 'flat' | 'down'
export interface Frame { id: string; label: string; dir: Dir; detail: string }
export interface RadarRow {
  coin: string; pair: string; price: number; ch24: number | null
  frames: Frame[] // 1h … 1 an: micro → macro
  breakout: boolean // today: above the 20-day high with heavy volume
  volUsd: number // 24h traded value, USDT
  zone: Zone; score: number; rules: Rule[]
  entryLo: number; entryHi: number; stop: number; target: number; riskPct: number; rewardPct: number
  sma50: number; sma200: number; rsi: number; atr: number; high20: number; low20: number; high52: number
  note: string; at: string
}

export const RADAR_COINS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'LINK', 'DOT', 'AVAX', 'EGLD']
/** Stablecoins, wrapped and leveraged tokens: no point analysing them. */
export const SKIP = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|EUR|EURI|AEUR|USDE|USD1|PYUSD|RLUSD|BFUSD|XUSD|GBP|TRY|BRL|WBTC|WBETH|BETH|PAXG|XAUT)$|(UP|DOWN|BULL|BEAR)$/
export const ZONE_LABEL: Record<Zone, string> = { buy: 'De cumpărat', wait: 'Așteaptă retragerea', watch: 'Doar urmărește', avoid: 'Evită' }

const sma = (xs: number[], n: number, i = xs.length - 1) => { let s = 0; for (let k = i - n + 1; k <= i; k++) s += xs[k]; return s / n }
function ema(xs: number[], n: number): number[] {
  const k = 2 / (n + 1), out: number[] = []
  xs.forEach((x, i) => out.push(i === 0 ? x : out[i - 1] + (x - out[i - 1]) * k))
  return out
}
/** Wilder smoothing (RSI, ATR, ADX). */
function wilder(xs: number[], n: number): number[] {
  const out: number[] = []
  let prev = 0
  xs.forEach((x, i) => {
    if (i < n) { prev += x; out.push(i === n - 1 ? prev / n : NaN); if (i === n - 1) prev = prev / n }
    else { prev = (prev * (n - 1) + x) / n; out.push(prev) }
  })
  return out
}
export function indicators(cs: Candle[]) {
  const c = cs.map(x => x.c), h = cs.map(x => x.h), l = cs.map(x => x.l)
  const last = cs.length - 1
  const tr = cs.map((x, i) => (i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - c[i - 1]), Math.abs(x.l - c[i - 1]))))
  const atrS = wilder(tr, 14)
  const up = c.map((x, i) => (i === 0 ? 0 : Math.max(x - c[i - 1], 0))), dn = c.map((x, i) => (i === 0 ? 0 : Math.max(c[i - 1] - x, 0)))
  const au = wilder(up, 14), ad = wilder(dn, 14)
  const rsi = ad[last] === 0 ? 100 : 100 - 100 / (1 + au[last] / ad[last])
  const pdm = cs.map((x, i) => { if (i === 0) return 0; const u = x.h - h[i - 1], d = l[i - 1] - x.l; return u > d && u > 0 ? u : 0 })
  const ndm = cs.map((x, i) => { if (i === 0) return 0; const u = x.h - h[i - 1], d = l[i - 1] - x.l; return d > u && d > 0 ? d : 0 })
  const pS = wilder(pdm, 14), nS = wilder(ndm, 14)
  const pdi = pS.map((v, i) => (100 * v) / atrS[i]), ndi = nS.map((v, i) => (100 * v) / atrS[i])
  const dx = pdi.map((v, i) => (Number.isFinite(v) && Number.isFinite(ndi[i]) && v + ndi[i] > 0 ? (100 * Math.abs(v - ndi[i])) / (v + ndi[i]) : 0))
  const adx = wilder(dx.slice(14), 14).pop() ?? NaN
  const e12 = ema(c, 12), e26 = ema(c, 26)
  const macdL = e12.map((v, i) => v - e26[i]), sig = ema(macdL, 9)
  const prior = (arr: number[], n: number, f: (...a: number[]) => number) => f(...arr.slice(last - n, last))
  return {
    close: c[last], sma20: sma(c, 20), sma50: sma(c, 50), sma200: c.length >= 200 ? sma(c, 200) : sma(c, c.length),
    sma50prev: sma(c, 50, last - 5), e5: ema(c, 5)[last], e8: ema(c, 8)[last], e13: ema(c, 13)[last],
    rsi, atr: atrS[last], atr50: sma(atrS.filter(Number.isFinite), 50), adx, pdi: pdi[last], ndi: ndi[last],
    macd: macdL[last], signal: sig[last], high20: prior(h, 20, Math.max), low20: prior(l, 20, Math.min), low10: Math.min(...l.slice(last - 9)),
    high52: Math.max(...h.slice(-365)),
  }
}

const pct = (a: number, b: number) => ((a - b) / b) * 100

/** Join k candles into one (2-day from daily, 3/6/12-month from monthly). Aligned to the newest. */
export function aggregate(cs: Candle[], k: number): Candle[] {
  const out: Candle[] = []
  for (let end = cs.length; end - k >= 0; end -= k) {
    const g = cs.slice(end - k, end)
    out.unshift({ t: g[0].t, o: g[0].o, h: Math.max(...g.map(x => x.h)), l: Math.min(...g.map(x => x.l)), c: g[g.length - 1].c, v: g.reduce((a, x) => a + x.v, 0) })
  }
  return out
}

/** Direction on one timeframe: averages, their slope, MACD and RSI (enough bars) or plain change (few bars). */
export function frameDir(cs: Candle[]): { dir: Dir; detail: string } {
  if (cs.length < 3) return { dir: 'flat', detail: 'prea puține date' }
  const c = cs.map(x => x.c), p = c[c.length - 1]
  if (cs.length < 30) {
    const n = Math.min(cs.length - 1, 4), ch = pct(p, c[c.length - 1 - n])
    const hi = Math.max(...cs.map(x => x.h)), lo = Math.min(...cs.map(x => x.l)), place = (p - lo) / (hi - lo || 1)
    const dir: Dir = ch > 5 && place > 0.5 ? 'up' : ch < -5 && place < 0.5 ? 'down' : 'flat'
    return { dir, detail: `${ch >= 0 ? '+' : ''}${ch.toFixed(0)}% · ${Math.round(place * 100)}% din interval` }
  }
  const e20 = ema(c, 20), e50 = ema(c, Math.min(50, c.length - 1)), m = ema(c, 12).map((v, i) => v - ema(c, 26)[i]), sg = ema(m, 9)
  const last = c.length - 1, slope = e20[last] > e20[last - 3]
  let pts = 0
  if (p > e20[last]) pts++; else pts--
  if (e20[last] > e50[last]) pts++; else pts--
  if (slope) pts++; else pts--
  if (m[last] > sg[last]) pts++; else pts--
  const dir: Dir = pts >= 2 ? 'up' : pts <= -2 ? 'down' : 'flat'
  return { dir, detail: `${p > e20[last] ? 'peste' : 'sub'} media 20 · MACD ${m[last] > sg[last] ? 'în sus' : 'în jos'}` }
}

/** Long horizons (3 months … 1 year) from daily candles: change and place in the range. */
export function horizonDir(daily: Candle[], days: number): { dir: Dir; detail: string } {
  const cs = daily.slice(-days)
  if (cs.length < days * 0.6) return { dir: 'flat', detail: 'monedă prea nouă' }
  const p = cs[cs.length - 1].c, ch = pct(p, cs[0].c)
  const hi = Math.max(...cs.map(x => x.h)), lo = Math.min(...cs.map(x => x.l)), place = (p - lo) / (hi - lo || 1)
  const dir: Dir = ch > 10 && place > 0.5 ? 'up' : ch < -10 && place < 0.5 ? 'down' : 'flat'
  return { dir, detail: `${ch >= 0 ? '+' : ''}${ch.toFixed(0)}% · la ${Math.round(place * 100)}% din intervalul perioadei` }
}

export interface Series { h1?: Candle[]; h4?: Candle[]; h8?: Candle[]; d1: Candle[]; w1?: Candle[]; m1?: Candle[] }
export function frames(s: Series): Frame[] {
  const F = (id: string, label: string, r: { dir: Dir; detail: string }): Frame => ({ id, label, ...r })
  return [
    F('1h', '1 oră', frameDir(s.h1 ?? [])), F('4h', '4 ore', frameDir(s.h4 ?? [])), F('8h', '8 ore', frameDir(s.h8 ?? [])),
    F('1d', '1 zi', frameDir(s.d1)), F('2d', '2 zile', frameDir(aggregate(s.d1, 2))), F('1w', '1 săpt.', frameDir(s.w1 ?? [])),
    F('1M', '1 lună', frameDir(s.m1 ?? [])), F('3M', '3 luni', horizonDir(s.d1, 91)), F('6M', '6 luni', horizonDir(s.d1, 182)), F('1y', '1 an', horizonDir(s.d1, 365)),
  ]
}
const f = (x: number) => (x >= 100 ? Math.round(x).toLocaleString('ro-RO') : x >= 1 ? x.toFixed(2) : x.toPrecision(3))

/** Zone + plan for one coin from daily candles (oldest first) and optional 4h candles for the timing. */
export function analyze(coin: string, daily: Candle[], h4: Candle[] = [], ch24: number | null = null, more: Omit<Series, 'd1' | 'h4'> = {}, volUsd = 0): RadarRow {
  const d = indicators(daily)
  const fr = frames({ ...more, d1: daily, h4 })
  const vol20 = daily.slice(-21, -1).reduce((a, x) => a + x.v, 0) / 20
  const breakout = daily[daily.length - 1].c > d.high20 && daily[daily.length - 1].v > 1.5 * vol20
  const p = d.close
  const t4 = h4.length > 30 ? indicators(h4) : null
  const range20 = pct(d.high20, d.low20)
  const extended = (p - d.sma20) / d.atr // how many daily moves above the 20-day average
  const rules: Rule[] = [
    { id: 'trend', label: 'Tendință în sus (preț > media 50 > media 200)', ok: p > d.sma50 && d.sma50 > d.sma200, detail: `media 50: ${f(d.sma50)} · media 200: ${f(d.sma200)}` },
    { id: 'golden', label: 'Golden cross (media 50 peste 200, în creștere)', ok: d.sma50 > d.sma200 && d.sma50 >= d.sma50prev, detail: d.sma50 > d.sma200 ? 'media 50 e peste 200' : 'media 50 e sub 200' },
    { id: 'adx', label: 'Forța tendinței (ADX ≥ 20, cumpărătorii conduc)', ok: d.adx >= 20 && d.pdi > d.ndi, detail: `ADX ${d.adx.toFixed(0)} · +DI ${d.pdi.toFixed(0)} / −DI ${d.ndi.toFixed(0)}` },
    { id: 'ema', label: 'Mediile scurte aliniate (5 > 8 > 13)', ok: d.e5 > d.e8 && d.e8 > d.e13, detail: `${f(d.e5)} / ${f(d.e8)} / ${f(d.e13)}` },
    { id: 'macd', label: 'MACD peste semnal', ok: d.macd > d.signal, detail: `${d.macd > d.signal ? 'peste' : 'sub'} linia de semnal` },
    { id: 'rsi', label: 'RSI sănătos (45–70)', ok: d.rsi >= 45 && d.rsi <= 70, detail: `RSI ${d.rsi.toFixed(0)}${d.rsi > 70 ? ' (prea încins)' : d.rsi < 45 ? ' (slab)' : ''}` },
    { id: 'contract', label: 'Contracție (Ciprian): prețul se strânge', ok: d.atr < d.atr50 && range20 < 20, detail: `interval 20 zile: ${range20.toFixed(0)}% · volatilitate ${d.atr < d.atr50 ? 'în scădere' : 'în creștere'}` },
    { id: 'speed', label: 'Viteză (Ciprian): iese peste maximul recent', ok: p > d.high20 || (t4 != null && t4.close > t4.high20), detail: p > d.high20 ? `peste maximul pe 20 de zile${breakout ? ', cu volum mare' : ''}` : t4 && t4.close > t4.high20 ? 'peste maximul pe 4 ore' : `maxim 20 zile: ${f(d.high20)}` },
    { id: 'high', label: 'Minervini: la cel mult 25% sub maximul pe 1 an', ok: p >= d.high52 * 0.75, detail: `${pct(p, d.high52).toFixed(0)}% față de maximul pe 1 an (${f(d.high52)})` },
  ]
  const score = rules.filter(r => r.ok).length
  const up = rules[0].ok
  const down = p < d.sma200 || (p < d.sma50 && d.e5 < d.e8 && d.e8 < d.e13)
  // Micro (1h–8h) times the entry, medium (1 day–1 week) is the trend we trade, macro (1 month–1 year) is the big picture.
  const cnt = (ids: string[], dir: Dir) => fr.filter(x => ids.includes(x.id) && x.dir === dir).length
  const microDown = cnt(['1h', '4h', '8h'], 'down') >= 2
  const macroDown = cnt(['1M', '3M', '6M', '1y'], 'down') >= 3
  const macroUp = cnt(['1M', '3M', '6M', '1y'], 'up') >= 2
  let zone: Zone = 'watch'
  if (down) zone = 'avoid'
  else if (up && score >= 6 && extended <= 2 && !macroDown && !microDown) zone = 'buy'
  else if (up && score >= 4) zone = 'wait'
  if (zone === 'buy' && !macroUp && cnt(['1d', '2d', '1w'], 'up') < 2) zone = 'wait'

  // Plan. Buy now (green) or on a pullback to the short averages (yellow / white).
  const entryHi = zone === 'buy' ? p + 0.25 * d.atr : Math.max(d.e13, d.sma20)
  const entryLo = zone === 'buy' ? Math.max(p - 0.5 * d.atr, d.e8) : Math.min(d.e13, d.sma20)
  const entry = (entryLo + entryHi) / 2
  // Stop under the last 10-day low, never more than 2.5 daily moves away (and at least 1).
  const swingStop = d.low10 - 0.25 * d.atr
  const stop = Math.min(entry - d.atr, Math.max(swingStop, entry - 2.5 * d.atr))
  const risk = entry - stop
  const target = Math.max(d.high20 > entry * 1.02 ? d.high20 : 0, entry + 2 * risk)
  const note = zone === 'buy' ? 'Trece regulile pe zi, iar imaginea mare (luni, an) nu e în jos: se poate intra în intervalul arătat.'
    : zone === 'wait' ? (extended > 2 ? 'Tendință bună, dar a urcat prea repede: așteaptă să coboare în zona de intrare.'
      : microDown ? 'Tendință bună pe zi, dar pe ore coboară acum: așteaptă să se întoarcă în sus pe 4 ore.'
      : macroDown ? 'Pe zi arată bine, dar pe luni și pe an e în jos: e doar o revenire, riscant.'
      : 'Tendință bună, dar nu trec destule reguli încă: așteaptă confirmarea.')
    : zone === 'avoid' ? 'Tendință în jos: nu cumpăra până nu revine peste mediile mari.'
    : 'Fără direcție clară: urmărește, nu cumpăra încă.'
  return {
    coin, pair: `${coin}/USDT`, price: p, ch24, frames: fr, breakout, volUsd, zone, score, rules,
    entryLo, entryHi, stop, target, riskPct: (risk / entry) * 100, rewardPct: ((target - entry) / entry) * 100,
    sma50: d.sma50, sma200: d.sma200, rsi: d.rsi, atr: d.atr, high20: d.high20, low20: d.low20, high52: d.high52,
    note, at: new Date().toISOString(),
  }
}

/** Binance kline arrays → candles. */
export const toCandles = (k: any[]): Candle[] => (Array.isArray(k) ? k : []).map(r => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), v: Number(r[5]) }))
