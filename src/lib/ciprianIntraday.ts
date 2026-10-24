import type { Candle } from './cryptoRadar.ts'

/**
 * Ciprian's entry on 1h/4h candles, the "⭐" moment:
 * strong breakout out of a lateral (huge volume) → pullback with small candles and calm volume that holds
 * above the broken line (max 38% false break, above the base's axis) → the pullback's own falling line is broken
 * on fresh volume. Entry at that close, stop under the pullback, TP1 = the top before the pullback,
 * TP2 = the first impulse measured again from the pullback low.
 */
export interface IntradaySignal {
  at: number // candle open time of the trigger
  key: string // breakout + top times: one alert per structure
  entry: number; stop: number; tp1: number; tp2: number
  line: number // the broken lateral top
  pullbackLow: number; top: number; axis: number; falseLimit: number
  riskPct: number; rr1: number; volX: number
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export function atrOf(cs: Candle[], i: number, n = 14): number {
  let t = 0
  for (let k = Math.max(1, i - n + 1); k <= i; k++) t += Math.max(cs[k].h - cs[k].l, Math.abs(cs[k].h - cs[k - 1].c), Math.abs(cs[k].l - cs[k - 1].c))
  return t / n
}

/** Checks whether the LAST candle of `cs` (closed) is Ciprian's entry. Returns null otherwise. */
export function ciprianIntraday(cs: Candle[], opt: { lookback?: number; minPullback?: number; breakoutVol?: number } = {}): IntradaySignal | null {
  const lookback = opt.lookback ?? 72, minPb = opt.minPullback ?? 6, bVol = opt.breakoutVol ?? 3
  const i = cs.length - 1
  if (i < 60) return null
  const c = cs.map(x => x.c), v = cs.map(x => x.v)
  // 1. The strongest breakout (highest volume multiple) out of a 30-candle lateral, at least minPb+2 candles ago.
  //    Smaller breakouts after it are the false breaks / pauses inside the same structure.
  let j0 = -1, line = 0, boxLow = 0, best = 0
  for (let j = i - minPb - 2; j >= Math.max(31, i - lookback); j--) {
    const box = cs.slice(j - 30, j), bh = Math.max(...box.map(x => x.h)), bl = Math.min(...box.map(x => x.l))
    const vx = v[j] / (avg(v.slice(j - 20, j)) || 1)
    if ((bh - bl) / bl < 0.25 && c[j] > bh * 1.005 && vx >= bVol && vx > best) { j0 = j; line = bh; boxLow = bl; best = vx }
  }
  if (j0 < 0) return null
  // 2. Top after the breakout, then the pullback (closed candles before the trigger).
  let top = j0
  for (let k = j0; k < i; k++) if (cs[k].h > cs[top].h) top = k
  const pb = cs.slice(top + 1, i)
  if (pb.length < minPb) return null
  const topH = cs[top].h, pbLow = Math.min(...pb.map(x => x.l))
  const falseLimit = line - 0.38 * Math.max(topH - line, 0), axis = (line + boxLow) / 2
  if (pbLow < falseLimit || pbLow < axis) return null // too deep: the breakout failed
  if (Math.min(...pb.map(x => x.c)) < line * 0.98) return null // closed back under the line
  const impulseBody = Math.abs(c[j0] - cs[j0].o)
  if (avg(pb.map(x => Math.abs(x.c - x.o))) > 0.6 * impulseBody) return null // pullback candles not small
  if (avg(pb.map(x => x.v)) > 0.5 * v[j0]) return null // pullback volume not calm
  // 3. The pullback's falling line: through the highs from the top, lifted to sit on top of them.
  const pts = [cs[top], ...pb].map((x, q) => ({ x: q, y: x.h }))
  const n = pts.length, sx = avg(pts.map(p => p.x)), sy = avg(pts.map(p => p.y))
  const slope = pts.reduce((a, p) => a + (p.x - sx) * (p.y - sy), 0) / (pts.reduce((a, p) => a + (p.x - sx) ** 2, 0) || 1)
  if (slope >= 0) return null
  let lift = 0
  for (const p of pts) lift = Math.max(lift, p.y - (sy + slope * (p.x - sx)))
  const lineAt = (q: number) => sy + lift + slope * (q - sx)
  const qNow = n, qPrev = n - 1
  // 4. Trigger: this candle closes above the falling line, the one before did not, on fresh volume.
  const volX = v[i] / (avg(pb.map(x => x.v)) || 1)
  if (!(c[i] > lineAt(qNow) && c[i - 1] <= lineAt(qPrev) * 1.003 && volX >= 1.5)) return null
  const atr = atrOf(cs, i)
  const entry = c[i], stop = pbLow - 0.25 * atr
  const risk = entry - stop
  if (risk <= 0 || risk / entry > 0.1) return null
  const tp1 = Math.max(topH, entry + 0.5 * risk)
  const tp2 = Math.max(pbLow + (topH - boxLow), tp1) // "the first impulse sizes the second"
  return { at: cs[i].t, key: `${cs[j0].t}-${cs[top].t}`, entry, stop, tp1, tp2, line, pullbackLow: pbLow, top: topH, axis, falseLimit,
    riskPct: (risk / entry) * 100, rr1: (tp1 - entry) / risk, volX }
}
