// Crypto radar on Binance daily candles, with a concrete plan: where to buy, stop-loss, target.
// Ciprian's rules decide (area, speed, panic, broken channel/lateral, pullback with small candles);
// a few book rules (trend, ADX, RSI) are shown for context only.
// Pure functions, no imports: also deployed with the `crypto-radar` edge function.

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
export type Zone = 'buy' | 'wait' | 'watch' | 'avoid'
export type Signal = 'ciprian' | 'trend' | 'ambele' | null
export const SIGNAL_LABEL: Record<'ciprian' | 'trend' | 'ambele', string> = { ciprian: '✓ Setup Ciprian', trend: '✓ Trend (cărți)', ambele: '✓ Ciprian + Trend' }
export interface Rule { id: string; label: string; ok: boolean; detail: string }
export type Dir = 'up' | 'flat' | 'down'
export interface Frame { id: string; label: string; dir: Dir; detail: string }
export interface RadarRow {
  coin: string; pair: string; price: number; ch24: number | null
  frames: Frame[] // 1h … 1 an: micro → macro
  breakout: boolean // today: above the 20-day high with heavy volume
  volUsd: number // 24h traded value, USDT
  zone: Zone; score: number; rules: Rule[]
  signal?: Signal // which strategy says buy: Ciprian, Trend (cărți) or both
  entryLo: number; entryHi: number; stop: number; target: number; riskPct: number; rewardPct: number
  sma50: number; sma200: number; rsi: number; atr: number; high20: number; low20: number; high52: number; days?: number
  speed?: Speed; area?: Area; place?: number
  note: string; at: string
}

export const RADAR_COINS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'LINK', 'DOT', 'AVAX', 'EGLD']
/** Stablecoins, wrapped and leveraged tokens: no point analysing them. */
export const SKIP = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|EUR|EURI|AEUR|USDE|USD1|PYUSD|RLUSD|BFUSD|XUSD|GBP|TRY|BRL|WBTC|WBETH|BETH|PAXG|XAUT)$|(UP|DOWN|BULL|BEAR)$/
/** Tokenized stocks on Binance (TSLAB, MSTRB…): shares, not crypto. */
export const STOCK_TOKEN = /^(TSLA|MSTR|CRCL|NVDA|AAPL|COIN|HOOD|GOOGL|GOOG|AMZN|META|MSFT|SPY|QQQ|NFLX|AMD|PLTR|GME|AVGO|ORCL|BABA|SBET|BMNR|IBIT)B$/
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
    close: c[last], sma20: sma(c, 20), sma50: sma(c, 50), sma200: c.length >= 200 ? sma(c, 200) : NaN, days: c.length,
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

// ---------- Ciprian, "Contracții, tendințe și viteza unei tendințe" ----------
export type Speed = 1 | 2 | 3
export type Area = 'jos' | 'mijloc' | 'sus'
export interface CiprianRead {
  speed: Speed; rising: boolean // viteza: 1 = lateral (acumulare), 2 = urcare/coborâre înclinată, 3 = aproape verticală
  area: Area; place: number // unde e prețul în intervalul pe 1 an
  climaxAgo: number | null // zile de la ultima panică (lumânare roșie mare, cu volum uriaș, după o scădere)
  setup: null | { kind: 'canal' | 'lateral'; ago: number; line: number; touches: number }
  pullback: boolean; smallCandles: boolean; calmVolume: boolean; held: boolean
  pullbackLow: number; depth: number // retragerea ca parte din impuls (trebuie < 1)
  falseLimit: number; axis: number // falsa ruptură: max 38% din impuls sub linie; axa (mijlocul) bazei de nivel 1
  validHigh: number | null // ultimul maxim valid peste preț = ținta 1
}

/** Straight line through the highs of days [a, b], lifted to sit on top of them: a falling channel's upper edge. */
function upperLine(cs: Candle[], a: number, b: number) {
  const n = b - a + 1
  let sx = 0, sy = 0, sxy = 0, sxx = 0
  for (let k = a; k <= b; k++) { const x = k - a, y = cs[k].h; sx += x; sy += y; sxy += x * y; sxx += x * x }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx), icpt = (sy - slope * sx) / n
  let lift = 0
  for (let k = a; k <= b; k++) lift = Math.max(lift, cs[k].h - (icpt + slope * (k - a)))
  const at = (k: number) => icpt + lift + slope * (k - a)
  let touches = 0, last = -99
  for (let k = a; k <= b; k++) if (cs[k].h >= at(k) * 0.985 && k - last > 3) { touches++; last = k }
  return { at, touches, fall: (-slope * (b - a)) / (sy / n) }
}

/** Reads the structure the way Ciprian does: speed, area, panic, broken channel/lateral and the pullback to it. */
export function readCiprian(cs: Candle[], atr: number): CiprianRead {
  const i = cs.length - 1, c = cs.map(x => x.c)
  const avgV = (a: number, b: number) => { let t = 0, n = 0; for (let k = Math.max(0, a); k <= b; k++) { t += cs[k].v; n++ } return n ? t / n : 0 }
  const avgBody = (a: number, b: number) => { let t = 0, n = 0; for (let k = Math.max(0, a); k <= b; k++) { t += Math.abs(cs[k].c - cs[k].o); n++ } return n ? t / n : 0 }
  // Speed: the slope of the last 20 closes, as a move measured in daily ranges (ATR).
  const n = Math.min(20, i), xs = c.slice(i - n + 1)
  let sx = 0, sy = 0, sxy = 0, sxx = 0
  xs.forEach((y, x) => { sx += x; sy += y; sxy += x * y; sxx += x * x })
  const slope = (xs.length * sxy - sx * sy) / (xs.length * sxx - sx * sx || 1)
  const moveAtr = (slope * (xs.length - 1)) / (atr || 1)
  const jump10 = Math.abs(c[i] - c[Math.max(0, i - 10)]) / (atr || 1)
  const speed: Speed = Math.abs(moveAtr) >= 9 || jump10 >= 8 ? 3 : Math.abs(moveAtr) >= 3.5 ? 2 : 1
  const rising = moveAtr > 0
  // Area in the 1-year range.
  const yr = cs.slice(-365), hi = Math.max(...yr.map(x => x.h)), lo = Math.min(...yr.map(x => x.l))
  const place = (c[i] - lo) / (hi - lo || 1)
  const area: Area = place < 1 / 3 ? 'jos' : place < 2 / 3 ? 'mijloc' : 'sus'
  // Panic (selling climax): big red candle on huge volume after a fall, in the last ~5 months.
  let climaxAgo: number | null = null
  for (let k = i; k >= Math.max(31, i - 150); k--) {
    const x = cs[k], body = x.o - x.c, fell = c[k] < c[k - 30] * 0.85
    if (body > 0 && x.h - x.l >= 2 * atr && x.v >= 2.5 * avgV(k - 20, k - 1) && fell) { climaxAgo = i - k; break }
  }
  // Breakout: the most recent first close above a falling channel's upper line, or above a tight lateral, on volume.
  let setup: CiprianRead['setup'] = null, j0 = -1
  for (let j = i - 1; j >= Math.max(100, i - 25) && !setup; j--) {
    const volOk = cs[j].v >= 1.2 * avgV(j - 20, j - 1)
    if (!volOk) continue
    const L = upperLine(cs, j - 90, j - 3)
    if (L.fall >= 0.06 && L.touches >= 3 && c[j] > L.at(j) * 1.01 && c[j - 1] <= L.at(j - 1) * 1.01) { setup = { kind: 'canal', ago: i - j, line: L.at(i), touches: L.touches }; j0 = j; break }
    const box = cs.slice(j - 30, j), bh = Math.max(...box.map(x => x.h)), bl = Math.min(...box.map(x => x.l))
    if ((bh - bl) / bl < 0.25 && c[j] > bh * 1.005 && c[j - 1] <= bh) { setup = { kind: 'lateral', ago: i - j, line: bh, touches: 0 }; j0 = j }
  }
  // Pullback after the breakout: back near the line, with small candles and quieter volume, still holding above it.
  let pullback = false, smallCandles = false, calmVolume = false, held = false, pullbackLow = cs[i].l, depth = 1, falseLimit = 0, axis = 0
  if (setup) {
    let pk = j0
    for (let k = j0; k <= i; k++) if (c[k] > c[pk]) pk = k
    if (pk < i) {
      pullbackLow = Math.min(...cs.slice(pk + 1).map(x => x.l))
      const base = Math.min(...cs.slice(j0 - 20, j0 + 1).map(x => x.l))
      // "Expansiunile prețurilor": a false break may go under the line by at most 38% of the impulse above it,
      // and the pullback must stay above the axis (middle) of the base it broke out of.
      falseLimit = setup.line - 0.38 * Math.max(cs[pk].h - setup.line, 0)
      axis = (setup.line + Math.min(...cs.slice(j0 - 30, j0).map(x => x.l))) / 2
      depth = (cs[pk].h - pullbackLow) / (cs[pk].h - base || 1)
      pullback = pullbackLow <= setup.line + atr && c[i] < c[pk]
      held = c[i] >= setup.line * 0.98
      smallCandles = avgBody(pk + 1, i) <= 0.75 * avgBody(j0, pk)
      calmVolume = avgV(pk + 1, i) < avgV(j0, pk)
    }
  }
  // Last valid high above the price: a swing high clearly apart (≥1 ATR) from the swing high before it.
  const piv: number[] = []
  for (let k = Math.max(5, i - 250); k <= i - 5; k++) {
    const h = cs[k].h
    let top = true
    for (let q = k - 5; q <= k + 5 && top; q++) if (q !== k && cs[q].h > h) top = false
    if (top) piv.push(h)
  }
  const valid = piv.filter((h, q) => q === 0 || Math.abs(h - piv[q - 1]) >= atr)
  const above = valid.filter(h => h > c[i] * 1.02)
  const validHigh = above.length ? Math.min(...above) : null
  return { speed, rising, area, place, climaxAgo, setup, pullback, smallCandles, calmVolume, held, pullbackLow, depth, falseLimit, axis, validHigh }
}

/**
 * "Trend (cărți)": price > SMA50 > SMA200, a squeeze before (20-day range < 20% and ATR under its 50-day average),
 * then a close above the prior 20-day high on ≥ 1.5× volume — today or in the last 2 days.
 */
export function trendBreakout(cs: Candle[]) {
  const i = cs.length - 1
  const tr = cs.map((x, k) => (k === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - cs[k - 1].c), Math.abs(x.l - cs[k - 1].c))))
  const atrAt = (k: number) => { let t = 0; for (let q = k - 13; q <= k; q++) t += tr[q]; return t / 14 }
  const atr50 = (k: number) => { let t = 0; for (let q = k - 49; q <= k; q++) t += atrAt(q); return t / 50 }
  let out = { broke: false, squeezed: false, ago: 0, level: 0, range: 0, volX: 0 }
  for (let j = i; j >= i - 2 && j > 80; j--) {
    const prev = cs.slice(j - 20, j), hi = Math.max(...prev.map(x => x.h)), lo = Math.min(...prev.map(x => x.l))
    const range = ((hi - lo) / lo) * 100, avgV = prev.reduce((a, x) => a + x.v, 0) / 20, volX = cs[j].v / (avgV || 1)
    const squeezed = range < 20 && atrAt(j - 1) < atr50(j - 1)
    if (j === i) out = { broke: false, squeezed, ago: 0, level: hi, range, volX }
    if (cs[j].c > hi && volX >= 1.5) return { broke: true, squeezed, ago: i - j, level: hi, range, volX }
  }
  return out
}

/** Zone + plan for one coin from daily candles (oldest first) and optional 4h candles for the timing. */
export function analyze(coin: string, daily: Candle[], h4: Candle[] = [], ch24: number | null = null, more: Omit<Series, 'd1' | 'h4'> = {}, volUsd = 0): RadarRow {
  const d = indicators(daily)
  const fr = frames({ ...more, d1: daily, h4 })
  const vol20 = daily.slice(-21, -1).reduce((a, x) => a + x.v, 0) / 20
  const breakout = daily[daily.length - 1].c > d.high20 && daily[daily.length - 1].v > 1.5 * vol20
  const p = d.close
  // Under 200 days of history there is no real 200-day average and no 1-year range: we can't judge the area.
  const short = d.days < 200
  const shortTxt = `istoric prea scurt: doar ${d.days} zile (trebuie 200)`
  const k = readCiprian(daily, d.atr)
  const speedTxt = k.speed === 1 ? 'viteza 1: lateral (acumulare)' : k.speed === 2 ? `viteza 2: ${k.rising ? 'urcă' : 'coboară'} înclinat` : `viteza 3: ${k.rising ? 'urcă' : 'cade'} aproape vertical`
  const distribution = k.speed === 3 && k.rising
  const falling = !k.rising && k.speed >= 2 && !k.setup
  const areaOk = !short && (k.area === 'jos' || (k.area === 'mijloc' && k.climaxAgo != null))
  const tp1 = k.validHigh
  const tb = trendBreakout(daily)
  const rules: Rule[] = [
    // Ciprian: these decide.
    { id: 'zona', label: 'Zona prețului (Ciprian): jos, sau la mijloc doar după panică', ok: areaOk, detail: short ? shortTxt : `zona ${k.area}: la ${Math.round(k.place * 100)}% din intervalul pe 1 an${k.area === 'sus' ? ' · „în zonă înaltă nu cumperi”' : k.area === 'mijloc' && k.climaxAgo == null ? ' · la mijloc e 50/50' : ''}` },
    { id: 'viteza', label: 'Viteza (Ciprian): nu e viteza 3 în sus (distribuție)', ok: !distribution, detail: speedTxt },
    { id: 'panica', label: 'Panică (Ciprian): cădere cu volum uriaș în ultimele 5 luni', ok: k.climaxAgo != null, detail: k.climaxAgo != null ? `acum ${k.climaxAgo} zile` : 'nu a fost' },
    { id: 'structura', label: 'Structura (Ciprian): canal de scădere sau lateral rupt cu volum', ok: k.setup != null, detail: k.setup ? `${k.setup.kind === 'canal' ? `canal de scădere (${k.setup.touches} atingeri)` : 'lateral'} rupt acum ${k.setup.ago} zile · linia la ${f(k.setup.line)}` : 'nicio ruptură în ultimele 25 de zile' },
    { id: 'pullback', label: 'Pullback (Ciprian): revine la linie cu lumânări mici și volum mic', ok: k.pullback && k.held && k.smallCandles && k.calmVolume, detail: !k.setup ? 'așteaptă întâi ruptura' : !k.pullback ? 'nu a revenit încă la linie' : !k.held ? 'a căzut sub linie: ruptură falsă' : !k.smallCandles ? 'lumânările retragerii sunt mari' : !k.calmVolume ? 'volumul retragerii e mare' : 'lumânări mici, volum mic, ține linia' },
    { id: 'adancime', label: 'Falsa ruptură max 38% și deasupra axei (Ciprian)', ok: k.setup != null && k.pullback && k.pullbackLow >= k.falseLimit && k.pullbackLow >= k.axis, detail: !(k.setup && k.pullback) ? '—' : k.pullbackLow < k.falseLimit ? `a coborât la ${f(k.pullbackLow)}, sub limita de 38% (${f(k.falseLimit)}): ruptura a eșuat` : k.pullbackLow < k.axis ? `a coborât sub axa bazei (${f(k.axis)})` : `minimul ${f(k.pullbackLow)} e peste limita ${f(Math.max(k.falseLimit, k.axis))}` },
    { id: 'contractie', label: 'Contracția mai mică decât impulsul (Ciprian)', ok: k.setup != null && k.pullback && k.depth < 1, detail: k.setup && k.pullback ? `retragerea = ${Math.round(k.depth * 100)}% din urcare` : '—' },
    // The second strategy, "Trend (cărți)": already rising, squeezed, then breaks out on volume. Tested on BTC 2017–2026.
    { id: 'trend', label: 'Trend (cărți): preț > media 50 > media 200', ok: !short && p > d.sma50 && d.sma50 > d.sma200, detail: short ? shortTxt : `media 50: ${f(d.sma50)} · media 200: ${f(d.sma200)}` },
    { id: 'strans', label: 'Trend (cărți): prețul s-a strâns înainte (interval 20 zile < 20%, volatilitate în scădere)', ok: tb.squeezed, detail: `interval 20 zile: ${tb.range.toFixed(0)}%` },
    { id: 'spargere', label: 'Trend (cărți): spargere peste maximul pe 20 de zile cu volum ≥ 1,5×', ok: tb.broke, detail: tb.broke ? `acum ${tb.ago} zile, peste ${f(tb.level)} · volum ${tb.volX.toFixed(1)}×` : `maxim 20 zile: ${f(d.high20)}` },
    // Context only.
    { id: 'adx', label: 'Forța tendinței (ADX ≥ 20, cumpărătorii conduc)', ok: d.adx >= 20 && d.pdi > d.ndi, detail: `ADX ${d.adx.toFixed(0)} · +DI ${d.pdi.toFixed(0)} / −DI ${d.ndi.toFixed(0)}` },
    { id: 'rsi', label: 'RSI sănătos (45–70)', ok: d.rsi >= 45 && d.rsi <= 70, detail: `RSI ${d.rsi.toFixed(0)}${d.rsi > 70 ? ' (prea încins)' : d.rsi < 45 ? ' (slab)' : ''}` },
  ]
  const score = rules.filter(r => r.ok).length
  const ok = (id: string) => rules.find(r => r.id === id)!.ok
  const ciprianOk = ok('zona') && ok('viteza') && ok('structura') && ok('pullback') && ok('adancime') && ok('contractie')
  const trendOk = ok('trend') && ok('strans') && ok('spargere') && p >= tb.level * 0.98
  const microDown = fr.filter(x => ['1h', '4h', '8h'].includes(x.id) && x.dir === 'down').length >= 2
  const cipBuy = !short && ciprianOk && !microDown
  const signal: Signal = cipBuy && trendOk ? 'ambele' : cipBuy ? 'ciprian' : trendOk ? 'trend' : null

  let zone: Zone = 'watch'
  if (short) zone = 'watch'
  else if (signal) zone = 'buy'
  else if (distribution || falling) zone = 'avoid'
  else if (k.setup && areaOk) zone = 'wait'

  // Plan. Ciprian: buy at the pullback to the line, stop under the pullback low, target 1 = last valid high.
  // Trend: buy near the breakout, stop under the last 10-day low, then a stop that climbs 3 × ATR under the high.
  const useCip = signal === 'ciprian' || signal === 'ambele' || (!signal && k.setup != null)
  const lineNow = useCip ? (k.setup?.line ?? d.high20) : signal === 'trend' ? tb.level : d.high20
  const entryLo = zone === 'buy' ? Math.max(lineNow, p - 0.5 * d.atr) : lineNow
  const entryHi = zone === 'buy' ? p + 0.25 * d.atr : lineNow + 0.5 * d.atr
  const entry = (entryLo + entryHi) / 2
  const swingStop = (useCip && k.pullback ? k.pullbackLow : Math.min(lineNow, d.low10)) - 0.25 * d.atr
  const stop = Math.min(entry - d.atr, Math.max(swingStop, entry - 3 * d.atr))
  const risk = entry - stop
  const target = useCip && tp1 != null && tp1 > entry + risk ? tp1 : entry + 2 * risk
  const cipTxt = k.setup ? `${k.setup.kind === 'canal' ? 'canalul de scădere' : 'lateralul'} rupt, pullback la linie cu lumânări mici` : ''
  const note = short ? `Prea nouă pe Binance (${d.days} zile de istoric): nu știm zona pe 1 an. Doar urmărește.`
    : signal === 'ambele' ? `✓ Setup Ciprian (${cipTxt}) și ✓ Trend (cărți) în același timp. Ținta 1 la ultimul maxim valid.`
    : signal === 'ciprian' ? `✓ Setup Ciprian: ${cipTxt}. Ținta 1 la ultimul maxim valid.`
    : signal === 'trend' ? `✓ Trend (cărți): urcă deja, s-a strâns și a spart maximul pe 20 de zile cu volum. Ieșire cu stop care urcă (3 × ATR sub maxim).${distribution ? ' Atenție: Ciprian ar vedea aici viteza 3 (distribuție).' : k.area === 'sus' ? ' Ciprian n-ar cumpăra aici (zonă înaltă).' : ''}`
    : distribution ? 'Viteza 3 în sus: e distribuție. Nu cumpăra; dacă ai deja, ia o parte din profit.'
    : falling ? `Coboară (${speedTxt}). Ciprian așteaptă panica, apoi lateralul jos, apoi ruptura. Nu cumpăra acum.`
    : zone === 'wait' ? (microDown && ciprianOk ? 'Structura lui Ciprian e completă pe zi, dar pe ore coboară acum: așteaptă întoarcerea pe 4 ore.'
      : !k.pullback ? `A rupt linia (${f(lineNow)}). Nu alerga după preț: așteaptă pullback-ul la linie cu lumânări mici.`
      : 'Pullback-ul nu e curat încă (lumânări sau volum mari): mai așteaptă.')
    : k.area === 'sus' ? '„În zonă înaltă nu cumperi.” Doar urmărește.'
    : k.area === 'mijloc' && k.climaxAgo == null ? 'La mijlocul intervalului, fără panică înainte: 50/50. Stai deoparte.'
    : k.speed === 1 && k.area === 'jos' ? `Acumulare în zona joasă: pune alarmă peste ${f(d.high20)} și așteaptă ruptura.`
    : 'Niciun semnal încă: urmărește.'
  return {
    coin, pair: `${coin}/USDT`, price: p, ch24, frames: fr, breakout, volUsd, zone, signal, score, rules,
    entryLo, entryHi, stop, target, riskPct: (risk / entry) * 100, rewardPct: ((target - entry) / entry) * 100,
    sma50: d.sma50, sma200: d.sma200, rsi: d.rsi, atr: d.atr, high20: d.high20, low20: d.low20, high52: d.high52, days: d.days, speed: k.speed, area: k.area, place: k.place,
    note, at: new Date().toISOString(),
  }
}

/** Binance kline arrays → candles. */
export const toCandles = (k: any[]): Candle[] => (Array.isArray(k) ? k : []).map(r => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), v: Number(r[5]) }))
