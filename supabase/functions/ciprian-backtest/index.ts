// Backtest of the radar's Ciprian "buy" on Binance daily history, in slices (CPU limit).
// mode 'signals' {coin, from, to}: days in [from,to) where the radar says buy. mode 'sim' {coin, sig, exit}: trades.
import { analyze, toCandles, type Candle } from "https://raw.githubusercontent.com/flaviusdanciu1996-tech/banii-la-virgula/e7135b0a679a7e46d09404d0734c0b775b272c69/supabase/functions/crypto-radar/radar.ts";
async function hist(sym: string): Promise<Candle[]> {
  let out: Candle[] = [], start = Date.UTC(2017, 7, 1)
  for (let k = 0; k < 6; k++) {
    const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=1d&limit=1000&startTime=${start}`)
    const c = toCandles(await r.json()); if (!c.length) break
    out = out.concat(c); start = c[c.length - 1].t + 86400000; if (c.length < 1000) break
  }
  return out
}
Deno.serve(async (req) => {
  const b = await req.json().catch(() => ({}))
  const cs = await hist(b.coin + 'USDT')
  if (b.mode === 'signals') {
    const sig: any[] = []
    for (let i = Math.max(400, b.from); i < Math.min(b.to, cs.length - 1); i++) {
      const row = analyze(b.coin, cs.slice(i - 399, i + 1))
      if (row.zone === 'buy') sig.push({ i, d: new Date(cs[i].t).toISOString().slice(0, 10), stop: row.stop, tgt: row.target, atr: row.atr, area: row.area })
    }
    return Response.json({ n: cs.length, sig })
  }
  const trades: any[] = []
  let free = 0
  for (const s of b.sig as any[]) {
    if (s.i < free) continue
    const i = s.i, e = cs[i + 1].o
    let j = i + 1, out = NaN, why = 'open', hi = e
    for (; j < cs.length; j++) {
      const x = cs[j]
      if (b.exit === 'trail') { hi = Math.max(hi, x.h); const ts = Math.max(s.stop, hi - 3 * s.atr); if (x.l <= ts) { out = Math.min(x.o, ts); why = 'trail'; break } }
      else { if (x.l <= s.stop) { out = Math.min(x.o, s.stop); why = 'stop'; break } if (x.h >= s.tgt) { out = Math.max(x.o, s.tgt); why = 'tinta'; break } }
      if (j - i > 365) { out = x.c; why = 'timp'; break }
    }
    if (Number.isNaN(out)) out = cs[cs.length - 1].c
    trades.push({ d: s.d, e: +e.toPrecision(6), out: +out.toPrecision(6), pct: +((out / e - 1) * 100).toFixed(1), why, days: j - i, area: s.area })
    free = j + 1
  }
  const comp = trades.reduce((a, t) => a * (1 + t.pct / 100), 1)
  return Response.json({ n: trades.length, win: trades.filter(t => t.pct > 0).length, total: +((comp - 1) * 100).toFixed(1), bh: +((cs[cs.length - 1].c / cs[400].c - 1) * 100).toFixed(0), from: new Date(cs[400].t).toISOString().slice(0, 10), trades })
})
