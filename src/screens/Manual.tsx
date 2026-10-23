import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Copy, Check, Search, BookOpen } from 'lucide-react'
import { supabase, DEMO } from '../db.ts'
import { Seg } from '../ui.tsx'
import { tvUrl, tvSymbol, type TvMarket } from '../lib/tradingview.ts'

/** One section of the personal trading manual. The content lives only in the user's own rows (RLS + 2FA), never in this public code. */
interface Sec { id: string; lesson_ord: number; lesson: string; sec_ord: number; title: string; body: string; tv: string | null }

const QUICK: { s: string; m: TvMarket }[] = [{ s: 'BTC', m: 'crypto' }, { s: 'ETH', m: 'crypto' }, { s: 'BONK', m: 'crypto' }, { s: 'TSLA', m: 'us' }, { s: 'TLV', m: 'bvb' }]

/** Light formatting: lines starting with "- " or "1. " become list items; the rest are paragraphs. */
function Body({ text }: { text: string }) {
  const blocks: { kind: 'p' | 'ul' | 'ol'; items: string[] }[] = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const kind = /^- /.test(t) ? 'ul' : /^\d+\. /.test(t) ? 'ol' : 'p'
    const item = t.replace(/^- |^\d+\. /, '')
    const last = blocks[blocks.length - 1]
    if (kind !== 'p' && last?.kind === kind) last.items.push(item)
    else blocks.push({ kind, items: [item] })
  }
  return <>{blocks.map((b, i) => b.kind === 'p' ? <p key={i} className="man-p">{b.items[0]}</p>
    : b.kind === 'ul' ? <ul key={i} className="man-list">{b.items.map((x, j) => <li key={j}>{x}</li>)}</ul>
    : <ol key={i} className="man-list">{b.items.map((x, j) => <li key={j}>{x}</li>)}</ol>)}</>
}

export function ManualScreen({ notify }: { notify: (m: string) => void }) {
  const [rows, setRows] = useState<Sec[] | null>(null)
  const [sym, setSym] = useState('')
  const [market, setMarket] = useState<TvMarket>('crypto')
  const [q, setQ] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!supabase || DEMO) { setRows([]); return }
    supabase.from('trading_manual').select('id, lesson_ord, lesson, sec_ord, title, body, tv').order('lesson_ord').order('sec_ord')
      .then(({ data }) => setRows((data ?? []) as Sec[]))
  }, [])

  const code = rows?.find(r => r.tv === 'code')
  const lessons = useMemo(() => {
    const m = new Map<number, { name: string; secs: Sec[] }>()
    const needle = q.trim().toLowerCase()
    for (const r of rows ?? []) {
      if (r.tv === 'code') continue
      if (needle && !(r.title + ' ' + r.body + ' ' + r.lesson).toLowerCase().includes(needle)) continue
      if (!m.has(r.lesson_ord)) m.set(r.lesson_ord, { name: r.lesson, secs: [] })
      m.get(r.lesson_ord)!.secs.push(r)
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
  }, [rows, q])

  const copy = async () => {
    if (!code) return
    try { await navigator.clipboard.writeText(code.body); setCopied(true); notify('Codul indicatorului e copiat'); setTimeout(() => setCopied(false), 2500) }
    catch { notify('Nu am putut copia. Ține apăsat pe cod și alege „Copiază”.') }
  }

  return (
    <div className="screen">
      <section className="card">
        <h2><ExternalLink size={16} /> Deschide un grafic în TradingView</h2>
        <Seg label="Piața" value={market} onChange={setMarket} options={[{ id: 'crypto', label: 'Crypto' }, { id: 'bvb', label: 'BVB' }, { id: 'us', label: 'SUA' }]} />
        <label className="field"><input placeholder={market === 'bvb' ? 'ex. TLV' : market === 'us' ? 'ex. TSLA' : 'ex. ETH'} value={sym} onChange={e => setSym(e.target.value)} autoCapitalize="characters" /></label>
        <div className="man-tv-row">
          <a className={'primary' + (sym.trim() ? '' : ' disabled')} href={sym.trim() ? tvUrl(sym, market, '240') : undefined} target="_blank" rel="noopener noreferrer">4 ore</a>
          <a className={'chip' + (sym.trim() ? '' : ' disabled')} href={sym.trim() ? tvUrl(sym, market, 'D') : undefined} target="_blank" rel="noopener noreferrer">1 zi</a>
          {sym.trim() && <span className="muted small">{tvSymbol(sym, market)}</span>}
        </div>
        <div className="chips">{QUICK.map(x => <a key={x.s} className="chip" href={tvUrl(x.s, x.m, '240')} target="_blank" rel="noopener noreferrer">{x.s}</a>)}</div>
      </section>

      {code && (
        <section className="card">
          <h2>Indicatorul „{code.title}”</h2>
          <p className="note">Desenează singur pe grafic linia, ruptura, pullback-ul, limita de 38%, axa, stopul și TP1, iar în dreapta sus bifează regulile. Îl adaugi o singură dată:</p>
          <ol className="steps-list">
            <li>Pe telefon, în Chrome: <b>tradingview.com</b> → meniul ⋮ → bifează <b>Site pentru desktop</b>. Intră în cont.</li>
            <li>Deschide orice grafic → jos, <b>Pine Editor</b>.</li>
            <li>Apasă butonul de mai jos, <b>Copiază codul</b>. În editor, șterge tot ce e acolo și lipește.</li>
            <li><b>Salvează</b> (nume: Ciprian), apoi <b>Adaugă pe grafic</b>.</li>
            <li>De acum, în aplicația TradingView: <b>Indicatori → Scripturile mele → Ciprian · structură</b>.</li>
          </ol>
          <button type="button" className="primary" onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copiat' : 'Copiază codul'}</button>
          <details className="explain"><summary>Vezi codul</summary><pre className="man-code">{code.body}</pre></details>
        </section>
      )}

      <label className="field radar-search"><Search size={16} /><input placeholder="Caută în manual (ex. pullback, 38%)" value={q} onChange={e => setQ(e.target.value)} /></label>

      {rows === null ? <p className="muted">Se încarcă…</p> : !lessons.length ? <p className="muted">{q ? 'Nimic găsit.' : 'Manualul e gol.'}</p> : lessons.map((l, i) => (
        <details key={l.name} className="card man-lesson" open={!!q || i === 0}>
          <summary><BookOpen size={16} /> <b>{l.name}</b> <span className="muted small">{l.secs.length}</span></summary>
          {l.secs.map(s => (
            <div key={s.id} className="man-sec">
              <h3 className="sub-h">{s.title}</h3>
              <Body text={s.body} />
              {s.tv && <p className="man-tv"><b>În TradingView:</b> {s.tv}</p>}
            </div>
          ))}
        </details>
      ))}
      <p className="hint">Materialul cursului e doar pentru uzul tău. Stă în contul tău, protejat cu 2FA, și nu apare în codul public al aplicației.</p>
    </div>
  )
}
