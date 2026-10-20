// Made-up BVB-like price series for the demo (?demo) — no network, same every time.
import type { StockData } from './lib/radar.ts'

function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 } }

const DEMO: [string, string, number, number, number, number | null, number | null, number | null][] = [
  // symbol, name, start price, yearly drift, yearly vol, P/E, P/BV, dividend %
  ['TLV', 'BANCA TRANSILVANIA S.A.', 18, 0.16, 0.22, 8.6, 1.9, 3.1],
  ['H2O', 'HIDROELECTRICA S.A.', 110, 0.14, 0.2, 18.9, 4.0, 5.2],
  ['SNP', 'OMV PETROM S.A.', 0.5, 0.18, 0.24, 9.5, 1.2, 6.8],
  ['SNN', 'NUCLEARELECTRICA S.A.', 40, 0.05, 0.25, 7.0, 1.1, 6.6],
  ['BRD', 'BRD - GROUPE SOCIETE GENERALE', 15, 0.12, 0.2, 14.0, 2.0, 3.4],
  ['DIGI', 'Digi Communications N.V.', 35, 0.2, 0.3, null, null, 0.9],
  ['M', 'MedLife S.A.', 6, 0.08, 0.35, null, 11.5, null],
  ['TVBETETF', 'ETF BET PATRIA-TRADEVILLE', 20, 0.14, 0.18, null, null, null],
]

export function demoStocks(): StockData[] {
  const today = Math.floor(Date.now() / 864e5)
  return DEMO.map(([symbol, name, p0, mu, sig, per, pbv, divy], n) => {
    const r = rng(n * 977 + 13), t: number[] = [], a: number[] = [], c: number[] = [], v: number[] = [], o: number[] = [], h: number[] = [], l: number[] = []
    let p = p0
    for (let d = today - 6 * 365; d <= today; d++) {
      const wd = new Date(d * 864e5).getUTCDay(); if (wd === 0 || wd === 6) continue
      const z = (r() + r() + r() - 1.5) * 2
      const prev = p
      p *= Math.exp((mu - sig * sig / 2) / 252 + (sig / Math.sqrt(252)) * z)
      t.push(d); a.push(+p.toFixed(4)); c.push(+p.toFixed(4)); o.push(+prev.toFixed(4)); h.push(+(Math.max(prev, p) * (1 + r() * sig / 25)).toFixed(4)); l.push(+(Math.min(prev, p) * (1 - r() * sig / 25)).toFixed(4)); v.push(Math.round(20000 + r() * 200000))
    }
    const divs: { d: number; a: number }[] = []
    if (divy) for (let y = 0; y < 6; y++) { const d = t[0] + 140 + y * 365; const i = t.findIndex(x => x >= d); if (i > 0) divs.push({ d: t[i], a: +(c[i] * divy / 100).toFixed(4) }) }
    return { symbol, name, per, pbv, divy, t, a, c, o, h, l, v, divs }
  })
}
