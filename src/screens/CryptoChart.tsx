import { useEffect, useMemo, useRef, useState } from 'react'
import { createChart, LineType, LineStyle, type IChartApi, type UTCTimestamp, type SeriesMarker, type Time } from 'lightweight-charts'
import { toCandles, analyze, ZONE_LABEL, type Candle, type RadarRow } from '../lib/cryptoRadar.ts'
import { cloud, trailingStop, channel, contraction, resistance, signals, readout } from '../lib/chartIndicators.ts'

/** Every interval Binance offers, from 1 minute to 1 month. */
export const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'] as const
const IV_LABEL: Record<string, string> = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '8h': '8h', '12h': '12h', '1d': '1Z', '3d': '3Z', '1w': '1S', '1M': '1L' }
type Layer = 'cloud' | 'stop' | 'channel' | 'squeeze' | 'volume' | 'plan' | 'signals'
const LAYERS: [Layer, string][] = [['cloud', 'Nor medii'], ['stop', 'Stop care urcă'], ['channel', 'Canal 20'], ['squeeze', 'Contracție'], ['volume', 'Volum'], ['plan', 'Plan'], ['signals', 'Semnale']]

const C = { up: '#2EBD85', down: '#F6465D', mixed: '#F0A733', stopUp: '#E8EEF8', stopDown: '#E040FB', hi: '#4C8DFF', lo: '#F6465D', vol: 'rgba(143,163,191,.35)', volHi: 'rgba(76,141,255,.75)' }
const tz = -new Date().getTimezoneOffset() * 60 // show local time on the axis
const T = (ms: number) => (Math.floor(ms / 1000) + tz) as UTCTimestamp

function readPref<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch { return d } }
function writePref(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }

export function CryptoChart({ coin, plan }: { coin: string; plan?: RadarRow | null }) {
  const [iv, setIv] = useState<string>(() => readPref('chart-iv', '4h'))
  const [layers, setLayers] = useState<Record<Layer, boolean>>(() => readPref('chart-layers', { cloud: true, stop: true, channel: true, squeeze: true, volume: true, plan: true, signals: true }))
  const [cs, setCs] = useState<Candle[] | null>(null)
  const [err, setErr] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => writePref('chart-iv', iv), [iv])
  useEffect(() => writePref('chart-layers', layers), [layers])

  // Candles straight from Binance (public market data), refreshed while the chart is open.
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${coin}USDT&interval=${iv}&limit=500`)
        if (!r.ok) throw new Error(String(r.status))
        const k = toCandles(await r.json())
        if (alive) { setCs(k); setErr('') }
      } catch { if (alive) setErr('Nu am putut lua graficul de la Binance. Verifică internetul.') }
    }
    setCs(null); load()
    const ms = ['1m', '3m', '5m', '15m', '30m', '1h'].includes(iv) ? 15000 : 60000
    const id = setInterval(load, ms)
    return () => { alive = false; clearInterval(id) }
  }, [coin, iv])

  const ind = useMemo(() => {
    if (!cs || cs.length < 60) return null
    return { cl: cloud(cs), ts: trailingStop(cs), ch: channel(cs), sq: contraction(cs), res: resistance(cs), sig: signals(cs), text: readout(cs), here: analyze(coin, cs) }
  }, [cs, coin])

  // Draw.
  useEffect(() => {
    const el = box.current
    if (!el || !cs || !ind) return
    const dark = document.documentElement.getAttribute('data-theme') !== 'light' && (document.documentElement.getAttribute('data-theme') === 'dark' || matchMedia('(prefers-color-scheme: dark)').matches)
    const ink = dark ? '#C9D4E5' : '#22324A', grid = dark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.06)'
    const chart = createChart(el, {
      height: 340, layout: { background: { color: 'transparent' }, textColor: ink, fontSize: 11 },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, timeVisible: !['1d', '3d', '1w', '1M'].includes(iv), rightOffset: 4 },
      crosshair: { mode: 0 }, handleScale: { axisPressedMouseMove: true }, localization: { locale: 'ro-RO' },
    })
    chartRef.current = chart
    const last = cs[cs.length - 1].c
    const precision = last >= 1000 ? 0 : last >= 10 ? 2 : last >= 1 ? 3 : last >= 0.01 ? 5 : 8
    const cand = chart.addCandlestickSeries({ upColor: C.up, downColor: C.down, wickUpColor: C.up, wickDownColor: C.down, borderVisible: false, priceFormat: { type: 'price', precision, minMove: 1 / 10 ** precision } })
    cand.setData(cs.map(x => ({ time: T(x.t), open: x.o, high: x.h, low: x.l, close: x.c })))
    const quiet = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }

    if (layers.volume) {
      const vAvg = (i: number) => cs.slice(Math.max(0, i - 20), i).reduce((a, y) => a + y.v, 0) / Math.max(1, Math.min(20, i))
      const vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', ...quiet })
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
      vol.setData(cs.map((x, i) => ({ time: T(x.t), value: x.v, color: i > 20 && x.v > 1.5 * vAvg(i) ? C.volHi : C.vol })))
    }
    if (layers.cloud) {
      const col = (i: number) => C[ind.cl.state[i]]
      chart.addLineSeries({ lineWidth: 1, ...quiet }).setData(cs.map((x, i) => ({ time: T(x.t), value: ind.cl.slow[i], color: col(i) + '99' })))
      chart.addLineSeries({ lineWidth: 3, ...quiet }).setData(cs.map((x, i) => ({ time: T(x.t), value: ind.cl.fast[i], color: col(i) })))
    }
    if (layers.stop) {
      chart.addLineSeries({ lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.6, ...quiet })
        .setData(cs.map((x, i) => ({ time: T(x.t), value: ind.ts.line[i], color: ind.ts.up[i] ? C.stopUp : C.stopDown })).slice(10))
    }
    if (layers.channel) {
      const pts = (arr: (number | null)[]) => cs.map((x, i) => (arr[i] == null ? null : { time: T(x.t), value: arr[i] as number })).filter(Boolean) as { time: UTCTimestamp; value: number }[]
      chart.addLineSeries({ color: C.hi, lineWidth: 2, lineType: LineType.WithSteps, ...quiet }).setData(pts(ind.ch.hi))
      chart.addLineSeries({ color: C.lo, lineWidth: 2, lineType: LineType.WithSteps, ...quiet }).setData(pts(ind.ch.lo))
    }
    if (layers.squeeze && ind.sq) {
      cand.createPriceLine({ price: ind.sq.hi, color: C.hi, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: 'contracție' })
      cand.createPriceLine({ price: ind.sq.lo, color: C.hi, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' })
    }
    if (ind.res) cand.createPriceLine({ price: ind.res, color: '#D9442E', lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: 'rezistență' })
    if (layers.plan && plan && (plan.zone === 'buy' || plan.zone === 'wait')) {
      cand.createPriceLine({ price: plan.entryHi, color: C.mixed, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'intrare' })
      cand.createPriceLine({ price: plan.entryLo, color: C.mixed, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' })
      cand.createPriceLine({ price: plan.stop, color: C.down, lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'stop-loss' })
      cand.createPriceLine({ price: plan.target, color: C.up, lineWidth: 2, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'țintă' })
    }
    if (layers.signals) {
      const m: SeriesMarker<Time>[] = ind.sig.map(s => s.kind === 'buy'
        ? { time: T(s.t), position: 'belowBar', color: C.up, shape: 'arrowUp', text: '▲' }
        : { time: T(s.t), position: 'aboveBar', color: C.stopDown, shape: 'arrowDown', text: '' })
      cand.setMarkers(m)
    }
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, cs.length - 140), to: cs.length + 4 })
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }))
    ro.observe(el)
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null }
  }, [cs, ind, layers, plan, iv])

  const toggle = (l: Layer) => setLayers(s => ({ ...s, [l]: !s[l] }))
  return (
    <div className="cchart">
      <div className="iv-row" role="tablist" aria-label="Interval">
        {INTERVALS.map(x => <button key={x} type="button" className="iv" aria-pressed={iv === x} onClick={() => setIv(x)}>{IV_LABEL[x]}</button>)}
      </div>
      <div ref={box} className="cchart-box">{!cs && !err && <div className="spinner" aria-label="Se încarcă" />}</div>
      {err && <p className="err small">{err}</p>}
      <div className="layer-row">{LAYERS.map(([id, label]) => <button key={id} type="button" className="chip small-chip" aria-pressed={layers[id]} onClick={() => toggle(id)}>{label}</button>)}</div>
      {ind && <div className="chart-read">
        <b>Pe intervalul {IV_LABEL[iv]}: {ZONE_LABEL[ind.here.zone]} · {ind.here.score}/9 reguli</b>
        <ul>{ind.text.map((t, i) => <li key={i}>{t}</li>)}</ul>
        <p className="muted small">Legenda: linia groasă = media rapidă (20), cea subțire = media lentă (50); verde = în sus, roșu = în jos, portocaliu = nehotărât. Punctele albe = stop care urcă (rămâi), roz = ieși. Treptele albastru/roșu = maximul și minimul pe 20 de bare. ▲ = spargere cu volum în tendință (cumpărare după regulile noastre), ▼ = stop atins. Verdictul principal (cel din radar) rămâne cel pe zile, săptămâni și luni.</p>
      </div>}
    </div>
  )
}
