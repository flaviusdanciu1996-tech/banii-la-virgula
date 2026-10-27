// Multi-timeframe reading (1m … 1d) of a list of coins, the way Ciprian reads a chart:
// direction, speed (1/2/3), zone in the range, last strong breakout and where the pullback is.
import { ciprianIntraday, atrOf, type Candle } from "./intraday.ts";
const TFS = ["1m", "5m", "15m", "30m", "1h", "4h", "8h", "1d"];
const ema = (xs: number[], n: number) => { const k = 2 / (n + 1); let e = xs[0]; return xs.map(x => (e = x * k + e * (1 - k))); };
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
function read(cs: Candle[]) {
  const i = cs.length - 1, c = cs.map(x => x.c), v = cs.map(x => x.v);
  const e20 = ema(c, 20), e50 = ema(c, 50), atr = atrOf(cs, i);
  const dir = c[i] > e20[i] && e20[i] > e50[i] ? "sus" : c[i] < e20[i] && e20[i] < e50[i] ? "jos" : "lateral";
  const xs = c.slice(-20); const sx = 9.5, sy = avg(xs);
  const slope = xs.reduce((a, y, x) => a + (x - sx) * (y - sy), 0) / xs.reduce((a, _y, x) => a + (x - sx) ** 2, 0);
  const mv = (slope * 19) / (atr || 1), jump = Math.abs(c[i] - c[i - 10]) / (atr || 1);
  const speed = Math.abs(mv) >= 9 || jump >= 8 ? 3 : Math.abs(mv) >= 3.5 ? 2 : 1;
  const w = cs.slice(-200), hi = Math.max(...w.map(x => x.h)), lo = Math.min(...w.map(x => x.l));
  const place = (c[i] - lo) / (hi - lo || 1), zone = place < 1 / 3 ? "jos" : place < 2 / 3 ? "mijloc" : "sus";
  // last strong breakout (≥3× volume out of a 30-candle box) in the last 72 candles
  let st = "fără ruptură";
  for (let j = i - 2; j >= Math.max(31, i - 72); j--) {
    const box = cs.slice(j - 30, j), bh = Math.max(...box.map(x => x.h)), bl = Math.min(...box.map(x => x.l));
    if ((bh - bl) / bl < 0.25 && c[j] > bh * 1.005 && v[j] >= 3 * avg(v.slice(j - 20, j))) {
      let top = j; for (let k = j; k <= i; k++) if (cs[k].h > cs[top].h) top = k;
      const topH = cs[top].h, axis = (bh + bl) / 2, fl = bh - 0.38 * (topH - bh);
      st = c[i] >= topH * 0.995 ? `rupt ${i - j} lum. în urmă, încă urcă` : c[i] < Math.max(fl, axis) ? `rupt ${i - j} lum. în urmă, pullback prea adânc (eșuat)` : `rupt ${i - j} lum. în urmă, ÎN PULLBACK (linia ${+bh.toPrecision(5)}, vârf ${+topH.toPrecision(5)}, axa ${+axis.toPrecision(5)})`;
      break;
    }
  }
  const sig = ciprianIntraday(cs);
  return { dir, speed, zone, place: Math.round(place * 100), st, star: sig ? { entry: +sig.entry.toPrecision(5), stop: +sig.stop.toPrecision(5), tp1: +sig.tp1.toPrecision(5), rr1: +sig.rr1.toFixed(2) } : null, price: +c[i].toPrecision(6) };
}
Deno.serve(async (req) => {
  const { coins = [] } = await req.json().catch(() => ({}));
  const out: Record<string, any> = {};
  await Promise.all((coins as string[]).flatMap((coin) => TFS.map(async (tf) => {
    try {
      const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${coin}USDT&interval=${tf}&limit=300`);
      const raw: any[] = await r.json(); if (!Array.isArray(raw) || raw.length < 120) return;
      const cs = raw.filter(k => Number(k[6]) < Date.now()).map(k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
      (out[coin] ??= {})[tf] = read(cs);
    } catch { /* skip */ }
  })));
  return Response.json(out);
});
