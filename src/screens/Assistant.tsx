import { useEffect, useMemo, useRef, useState } from 'react'
import { Send, Sparkles } from 'lucide-react'
import { useStore } from '../store.tsx'
import { supabase, DEMO } from '../db.ts'
import { useMarket } from './Radar.tsx'
import { score, passesRules, LABELS, isoOf } from '../lib/radar.ts'
import { kindOf } from '../lib/types.ts'
import { monthsToTarget } from '../lib/fi.ts'

interface Msg { role: 'user' | 'model'; text: string }
const KEY = 'banii-asistent'
const SUGGEST = ['Analizează portofoliul meu', 'Ce acțiuni trec regulile mele azi?', 'Analizează H2O', 'Unde aș putea pune 1.000 € luna asta?', 'Sunt prea expus pe o singură firmă?']

/** Very small formatter: **bold**, bullet lines, paragraphs. */
export function Rich({ text }: { text: string }) {
  const lines = text.split('\n')
  const out: JSX.Element[] = []
  let list: string[] = []
  const flush = () => { if (list.length) { out.push(<ul key={'u' + out.length}>{list.map((l, i) => <li key={i}>{bold(l)}</li>)}</ul>); list = [] } }
  const bold = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>)
  for (const raw of lines) {
    const l = raw.trim()
    if (/^[-*_]{3,}$/.test(l)) continue
    if (/^[-*•]\s+/.test(l)) { list.push(l.replace(/^[-*•]\s+/, '')); continue }
    flush()
    if (!l) continue
    if (/^#{1,4}\s/.test(l)) out.push(<h4 key={out.length}>{bold(l.replace(/^#+\s/, ''))}</h4>)
    else out.push(<p key={out.length}>{bold(l)}</p>)
  }
  flush()
  return <>{out}</>
}

export function buildContext(stocks: ReturnType<typeof useMarket>['stocks'], st: ReturnType<typeof useStore>) {
    if (!stocks) return null
  const rules = st.settings.radar?.rules ?? {}
  const radar = stocks.filter(s => s.t.length >= 220).map(s => {
    const sc = score(s), i = sc.ind
    return { simbol: s.symbol, nume: s.name, scor: sc.total, zona: LABELS[sc.label].text, fundamental: sc.fund, tehnic: sc.tech, risc: sc.risk,
      pret: i.price, pe: s.per, pbv: s.pbv, eps: s.eps, dividend_pct: i.divYield && Math.round(i.divYield * 10) / 10, rsi: i.rsi && Math.round(i.rsi),
      media50: i.ma50 && +i.ma50.toFixed(3), media200: i.ma200 && +i.ma200.toFixed(3), min_1an: i.lo52, max_1an: i.hi52,
      randament_1an_pct: i.ret1y && Math.round(i.ret1y), roe_pct: i.roe && Math.round(i.roe * 10) / 10, beta: i.beta && +i.beta.toFixed(2),
      macd: i.macd && { histograma_pct: +i.macd.hist.toFixed(2), accelereaza: i.macd.rising }, bollinger_pozitie_pct: i.boll && Math.round(i.boll.pctB * 100), volum_fata_de_normal: i.volRatio && +i.volRatio.toFixed(2), randament_3luni_pct: i.ret3m && Math.round(i.ret3m), volatilitate_pct: i.vol && Math.round(i.vol), cadere_max_1an_pct: i.dd && Math.round(i.dd),
      trece_regulile: passesRules(s, sc, rules).ok, motive: sc.reasons.map(r => (r.good === true ? '+ ' : r.good === false ? '- ' : '· ') + r.text) }
  }).sort((a, b) => b.scor - a.scor)
  const hold = st.assets.flatMap(a => a.holdings ?? []).map(h => {
    const v = h.price ? h.qty * h.price : h.cost / 100
    return { simbol: h.symbol, bucati: h.qty, cost_mediu: +(h.cost / 100 / h.qty).toFixed(4), pret: h.price, valoare_lei: Math.round(v), profit_lei: Math.round(v - h.cost / 100) }
  })
  const total = hold.reduce((a, h) => a + h.valoare_lei, 0)
  const sum = st.assets.find(a => a.invest_summary)?.invest_summary
  const s = st.settings, eur = st.rates.EUR
  const have = st.assets.filter(a => !a.archived && ['invest', 'liquid'].includes(kindOf(a.kind).section)).reduce((x, a) => x + a.value * (a.currency === 'EUR' ? eur : a.currency === 'USD' ? st.rates.USD : 1), 0) / 100
  return {
    data_preturi: stocks.length ? isoOf(Math.max(...stocks.map(x => x.t[x.t.length - 1]))) : null,
    portofoliu: { pozitii: hold.map(h => ({ ...h, pondere_pct: total ? Math.round((h.valoare_lei / total) * 100) : 0 })), total_lei: total,
      istoric: sum && { depus: sum.deposits / 100, retras: sum.withdrawals / 100, dividende: sum.dividends / 100, profit_vanzari: sum.realized / 100 } },
    independenta: s.fi_target ? { tinta: s.fi_target / 100, moneda: s.fi_currency, ai_acum_aprox_eur: Math.round(have / eur), pui_pe_luna: (s.fi_monthly ?? 0) / 100, randament_presupus: s.fi_return,
      luni_pana_la_tinta: monthsToTarget(Math.round(have / eur * 100), s.fi_monthly ?? 100000, s.fi_return ?? 7, s.fi_target) } : null,
    regulile_mele: s.radar?.rules ?? {}, urmarite: s.radar?.watch ?? [],
    radar: radar,
  }
}

export function AssistantScreen({ initial }: { initial?: string }) {
  const st = useStore()
  const { stocks } = useMarket()
  const [msgs, setMsgs] = useState<Msg[]>(() => { try { return JSON.parse(localStorage.getItem(KEY) || '[]').slice(-20) } catch { return [] } })
  const [q, setQ] = useState(initial ?? '')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(msgs.slice(-20))) } catch { /* fine */ } ; end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  // Everything the assistant may use — it is told to use only these numbers.
  const context = useMemo(() => buildContext(stocks, st), [stocks, st.assets, st.settings, st.rates])

  async function ask(text: string) {
    const t = text.trim()
    if (!t || busy) return
    const next = [...msgs, { role: 'user' as const, text: t }]
    setMsgs(next); setQ(''); setBusy(true)
    try {
      if (DEMO || !supabase) { await new Promise(r => setTimeout(r, 600)); setMsgs([...next, { role: 'model', text: 'În modul demo asistentul nu e conectat. În aplicația ta răspunde cu analiza pe datele tale.' }]); return }
      const { data, error } = await supabase.functions.invoke('invest-assistant', { body: { messages: next.slice(-10), context } })
      if (error || !data?.text) throw new Error(data?.error || 'err')
      setMsgs([...next, { role: 'model', text: data.text }])
    } catch (e: any) {
      setMsgs([...next, { role: 'model', text: e?.message === 'rate_limited' ? 'Am atins limita gratuită pe minut. Încearcă din nou peste un minut.' : 'Nu am putut răspunde acum. Încearcă din nou.' }])
    } finally { setBusy(false) }
  }
  useEffect(() => { if (initial && context && !msgs.some(m => m.text === initial)) ask(initial) }, [context === null])

  return (
    <div className="screen chat">
      {!msgs.length && (
        <div className="card chat-intro">
          <Sparkles size={22} />
          <b>Asistentul tău de investiții</b>
          <p className="muted small">Vede portofoliul tău, Radarul BVB (scoruri, P/E, dividende, RSI, trend), regulile tale și ținta de independență. Îți explică și îți arată riscurile; decizia rămâne a ta.</p>
        </div>
      )}
      <div className="msgs">
        {msgs.map((m, i) => <div key={i} className={'msg ' + m.role}>{m.role === 'model' ? <Rich text={m.text} /> : m.text}</div>)}
        {busy && <div className="msg model typing">Analizez…</div>}
        <div ref={end} />
      </div>
      {!busy && <div className="chips chat-sugg">{SUGGEST.map(s => <button key={s} type="button" className="chip" onClick={() => ask(s)}>{s}</button>)}</div>}
      <form className="chat-box" onSubmit={e => { e.preventDefault(); ask(q) }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={context ? 'Întreabă ceva…' : 'Încarc datele bursei…'} disabled={!context} />
        <button type="submit" className="primary" aria-label="Trimite" disabled={busy || !q.trim() || !context}><Send size={18} /></button>
      </form>
      {msgs.length > 0 && <button type="button" className="link" onClick={() => setMsgs([])}>Conversație nouă</button>}
    </div>
  )
}

/** One question with the full context, outside the chat (journal feedback). */
export async function askAssistant(text: string, context: unknown): Promise<string> {
  if (DEMO || !supabase) return 'În modul demo asistentul nu e conectat.'
  const { data, error } = await supabase.functions.invoke('invest-assistant', { body: { messages: [{ role: 'user', text }], context } })
  if (error || !data?.text) throw new Error(data?.error === 'rate_limited' ? 'Am atins limita gratuită pe minut. Încearcă peste un minut.' : 'Nu am putut primi răspuns acum.')
  return data.text
}
