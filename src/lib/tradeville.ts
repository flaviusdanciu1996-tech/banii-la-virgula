// Tradeville "Activitate" report → transactions → portfolio summary.
// Works with the report saved from the phone (.mht), the HTML/Excel export and the CSV export.
// Money in bani (minor units); quantities and prices as plain numbers.
import { num, type Holding } from './bvb.ts'
export { num, holdingsValue, bvbUrl, parseBvbPrice, type Holding } from './bvb.ts'

export interface InvestTx {
  ref: string
  at: string // ISO date-time
  op: string // cump, vanz, in, out, div, …
  symbol: string // ticker, or RON for cash movements
  price: number | null
  qty: number
  commission: number // bani
  net: number // bani, + money in / − money out of the account
  profit: number | null // bani, realised on sales
  note: string
}


export interface InvestSummary {
  deposits: number
  withdrawals: number
  dividends: number
  commissions: number
  realized: number
  cash: number
  first: string | null
  last: string | null
  count: number
}

const bani = (v: number) => Math.round(v * 100)

/** "10/25/21 10:00:18" (US) or "25.10.2021 10:00" or ISO → ISO string. */
export function parseWhen(s: string): string | null {
  const t = s.trim()
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  let y: number, mo: number, d: number, hh = 0, mi = 0, ss = 0
  if (m) { mo = +m[1]; d = +m[2]; y = +m[3]; hh = +(m[4] ?? 0); mi = +(m[5] ?? 0); ss = +(m[6] ?? 0) }
  else if ((m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/))) { d = +m[1]; mo = +m[2]; y = +m[3]; hh = +(m[4] ?? 0); mi = +(m[5] ?? 0); ss = +(m[6] ?? 0) }
  else if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/))) { y = +m[1]; mo = +m[2]; d = +m[3]; hh = +(m[4] ?? 0); mi = +(m[5] ?? 0); ss = +(m[6] ?? 0) }
  else return null
  if (y < 100) y += 2000
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${y}-${p(mo)}-${p(d)}T${p(hh)}:${p(mi)}:${p(ss)}`
}

/* ---------- Getting the table out of the file ---------- */

function decodeQP(s: string): string {
  return s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

/** Text of the HTML page inside an .mht file, or the file itself. */
export function htmlFromFile(bytes: Uint8Array): string {
  const latin = new TextDecoder('windows-1252').decode(bytes)
  if (/^MIME-Version:|^From: <Saved by|multipart\/related/im.test(latin.slice(0, 2000))) {
    const i = latin.search(/Content-Type:\s*text\/html/i)
    if (i >= 0) {
      const gap = /\r?\n\r?\n/.exec(latin.slice(i))
      const headEnd = gap ? i + gap.index : i
      const head = latin.slice(i, headEnd)
      const boundary = latin.match(/boundary="([^"]+)"/)?.[1]
      let body = latin.slice(headEnd).replace(/^\s+/, '')
      if (boundary) { const j = body.indexOf('--' + boundary); if (j >= 0) body = body.slice(0, j) }
      if (/quoted-printable/i.test(head)) body = decodeQP(body)
      if (/charset=["']?utf-8/i.test(body.slice(0, 1500))) {
        body = new TextDecoder('utf-8').decode(Uint8Array.from(body, c => c.charCodeAt(0) & 0xff))
      }
      return body
    }
  }
  const utf = new TextDecoder('utf-8').decode(bytes)
  return /�/.test(utf.slice(0, 5000)) ? latin : utf
}

const strip = (s: string) => s.replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim()

/** All rows (as cell texts) of the first HTML table whose header has the given columns. */
function htmlTable(html: string, mustHave: string[]): string[][] | null {
  for (const t of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const rows = (t.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map(r => (r.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) ?? []).map(strip))
    const hi = rows.findIndex(r => mustHave.every(h => r.some(c => c.toLowerCase() === h)))
    if (hi >= 0) return rows.slice(hi)
  }
  return null
}

function csvRows(text: string): string[][] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim())
  const head = lines.find(l => /oper/i.test(l)) ?? lines[0] ?? ''
  const sep = [';', '\t', ','].sort((a, b) => head.split(b).length - head.split(a).length)[0]
  return lines.map(l => {
    const out: string[] = []; let cur = '', q = false
    for (let i = 0; i < l.length; i++) {
      const ch = l[i]
      if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++ } else q = !q }
      else if (ch === sep && !q) { out.push(cur.trim()); cur = '' }
      else cur += ch
    }
    out.push(cur.trim())
    return out
  })
}

/** Stable id for a row, so importing the same period twice adds nothing. */
function refOf(t: Omit<InvestTx, 'ref'>): string {
  const s = [t.at, t.op, t.symbol, t.qty, t.net, t.commission].join('|')
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return `tv:${t.at}:${t.op}:${t.symbol}:${(h >>> 0).toString(36)}`
}

/** Notes may carry the account code; keep only what helps ("dividend SNP", "mcs gratuite", …). */
function cleanNote(op: string, raw: string): string {
  const n = raw.replace(/Pret dirty:?.*$/i, '').replace(/\b[A-Z0-9]{5,8}\.RO\b/g, '').replace(/\s+/g, ' ').trim()
  if (/DEPUNERE CONT CLIENT/i.test(n)) return 'Depunere'
  if (/RETRAGERE CONT CLIENT/i.test(n)) return 'Retragere'
  return n.slice(0, 80)
}

export interface ParsedReport { rows: InvestTx[]; cashEnd: number | null; broker: 'Tradeville' }

export function parseTradeville(bytes: Uint8Array, fileName = ''): ParsedReport {
  const text = htmlFromFile(bytes)
  const isHtml = /<table/i.test(text)
  const table = isHtml ? htmlTable(text, ['oper']) : csvRows(text)
  if (!table) throw new Error('not_tradeville')
  const hi = table.findIndex(r => r.some(c => /^oper/i.test(c)))
  if (hi < 0) throw new Error('not_tradeville')
  const head = table[hi].map(c => c.toLowerCase())
  const col = (...names: string[]) => head.findIndex(h => names.some(n => h.startsWith(n)))
  const c = {
    date: col('data'), op: col('oper'), sym: col('ticker', 'simbol'), price: col('pret'), qty: col('cantitate'),
    com: col('comision'), net: col('valoare net', 'valoare'), profit: col('profit'), note: col('observatii'),
  }
  if (c.date < 0 || c.op < 0 || c.net < 0) throw new Error('not_tradeville')
  const rows: InvestTx[] = []
  for (const r of table.slice(hi + 1)) {
    const at = parseWhen(r[c.date] ?? '')
    const op = (r[c.op] ?? '').trim().toLowerCase()
    if (!at || !op) continue
    const base = {
      at, op, symbol: (r[c.sym] ?? '').trim().toUpperCase() || 'RON',
      price: c.price >= 0 && r[c.price] ? num(r[c.price]) : null,
      qty: c.qty >= 0 ? Math.abs(num(r[c.qty])) : 0,
      commission: c.com >= 0 ? bani(Math.abs(num(r[c.com]))) : 0,
      net: bani(num(r[c.net])),
      profit: c.profit >= 0 && (r[c.profit] ?? '').trim() ? bani(num(r[c.profit])) : null,
      note: c.note >= 0 ? cleanNote(op, r[c.note] ?? '') : '',
    }
    rows.push({ ...base, ref: refOf(base) })
  }
  if (!rows.length) throw new Error('empty')
  const sold = strip(text).match(/Sold final bani\s*:?\s*([-\d.,]+)\s*RON/i)
  void fileName
  return { rows, cashEnd: sold ? bani(num(sold[1])) : null, broker: 'Tradeville' }
}

/* ---------- Portfolio from transactions ---------- */

/**
 * Replays the account: deposits, withdrawals, dividends, buys and sells at average cost (as Tradeville does),
 * free shares, consolidations and symbol changes (the cost moves to the new line).
 */
export function summarize(txs: InvestTx[]): { holdings: Holding[]; summary: InvestSummary } {
  const list = [...txs].sort((a, b) => a.at.localeCompare(b.at) || (a.op === 'out' ? -1 : b.op === 'out' ? 1 : 0))
  const pos = new Map<string, { qty: number; cost: number }>()
  const s: InvestSummary = { deposits: 0, withdrawals: 0, dividends: 0, commissions: 0, realized: 0, cash: 0, first: null, last: null, count: list.length }
  let moved: { cost: number; at: string } | null = null
  for (const t of list) {
    s.first ??= t.at.slice(0, 10); s.last = t.at.slice(0, 10)
    s.commissions += t.commission
    if (t.symbol === 'RON' || t.op === 'div') {
      if (t.op === 'in' && /depunere/i.test(t.note)) s.deposits += t.net
      else if (t.op === 'out' && /retragere/i.test(t.note)) s.withdrawals += -t.net
      else if (t.op === 'div') s.dividends += t.net
      else if (t.op === 'in') s.deposits += 0 // other cash in (fractions bought back) counts as gain via cash
      s.cash += t.net
      continue
    }
    const p = pos.get(t.symbol) ?? { qty: 0, cost: 0 }
    const avg = p.qty > 0 ? p.cost / p.qty : 0
    if (t.op === 'cump') { p.qty += t.qty; p.cost += -t.net; s.cash += t.net }
    else if (t.op === 'vanz') {
      p.cost -= Math.round(avg * t.qty); p.qty -= t.qty; s.cash += t.net
      if (t.profit !== null) s.realized += t.profit
    } else if (t.op === 'out') {
      const c = Math.round(avg * t.qty); p.qty -= t.qty; p.cost -= c
      moved = /consolidare|schimbare simbol|conversie|fuziune/i.test(t.note) ? { cost: c, at: t.at } : null
    } else if (t.op === 'in') {
      p.qty += t.qty
      if (moved && /consolidare|schimbare simbol|conversie|fuziune/i.test(t.note)) { p.cost += moved.cost; moved = null }
    }
    if (p.qty < 1e-9) { p.qty = 0; p.cost = 0 }
    pos.set(t.symbol, p)
  }
  const holdings = [...pos.entries()].filter(([, p]) => p.qty > 0).map(([symbol, p]) => ({ symbol, qty: Math.round(p.qty * 1e6) / 1e6, cost: Math.max(0, Math.round(p.cost)) }))
    .sort((a, b) => b.cost - a.cost)
  return { holdings, summary: s }
}

