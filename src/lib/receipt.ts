// Matching photographed receipts with bank entries, and splitting one payment across categories.
import type { Tx } from './types.ts'
import { diffDays } from './period.ts'

export interface ReceiptItem { name: string; name_ro?: string; amount: number; category: string }
export interface ReadReceipt { merchant: string; date: string; total: number; currency: string; items: ReceiptItem[] }

/** 12.5 → 1250 (minor units), robust to float noise. */
export const toMinor = (n: number) => Math.round(Number(n || 0) * 100)

/** "30.00 DKK" → { amount: 3000, currency: 'DKK' } */
export function parseOrigNote(s?: string | null): { amount: number; currency: string } | null {
  const m = (s || '').match(/([\d.,]+)\s*([A-Z]{3})/)
  if (!m) return null
  return { amount: toMinor(Number(m[1].replace(/,/g, ''))), currency: m[2] }
}

/** Does this bank entry pay exactly `total` in `currency`? */
export function paysAmount(t: Tx, total: number, currency: string): boolean {
  if (currency === 'RON' && !t.orig_currency && Math.abs(t.amount - total) <= 1) return true
  if (t.orig_currency === currency && t.orig_amount != null && Math.abs(t.orig_amount - total) <= 1) return true
  const o = parseOrigNote(t.orig_note)
  return !!o && o.currency === currency && Math.abs(o.amount - total) <= 1
}

/** The bank entry a new receipt belongs to (same amount, within 3 days, not already linked). */
export function matchReceipt(r: { total: number; currency: string; date: string }, txs: Tx[]): Tx | null {
  let best: Tx | null = null, bestD = 99
  for (const t of txs) {
    if (t.kind !== 'out' || t.receipt_id || !t.import_ref) continue
    const d = r.date ? Math.abs(diffDays(r.date, t.date)) : 0
    if (d > 3 || !paysAmount(t, r.total, r.currency)) continue
    if (d < bestD) { best = t; bestD = d }
  }
  return best
}

export interface PendingReceipt { receipt_id: string; total: number; currency: string; date: string; txs: Tx[] }

/** Receipts saved before their bank entry arrived. */
export function pendingReceipts(txs: Tx[]): PendingReceipt[] {
  const m = new Map<string, PendingReceipt>()
  for (const t of txs) {
    if (!t.receipt_id || t.receipt_total == null || !t.receipt_currency) continue
    const g = m.get(t.receipt_id) ?? { receipt_id: t.receipt_id, total: t.receipt_total, currency: t.receipt_currency, date: t.date, txs: [] }
    g.txs.push(t); m.set(t.receipt_id, g)
  }
  return [...m.values()].filter(g => g.txs.every(t => !t.import_ref))
}

/** The pending receipt a bank line from an import pays for. */
export function receiptForImport(p: { date: string; amount: number; currency: string; original: string }, pending: PendingReceipt[]): PendingReceipt | null {
  const o = parseOrigNote(p.original)
  for (const g of pending) {
    if (Math.abs(diffDays(g.date, p.date)) > 3) continue
    if ((o && o.currency === g.currency && Math.abs(o.amount - g.total) <= 1) || (p.currency === g.currency && Math.abs(p.amount - g.total) <= 1)) return g
  }
  return null
}

/** Split `total` (minor units) across weights proportionally; parts always add up exactly to total. */
export function splitProportional(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + Math.max(0, w), 0)
  if (!sum) return weights.map((_, i) => (i === 0 ? total : 0))
  const raw = weights.map(w => (Math.max(0, w) / sum) * total)
  const parts = raw.map(Math.floor)
  let left = total - parts.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0])
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) parts[order[k][1]]++
  return parts
}

/** Items grouped by category, in receipt order. */
export function groupItems(items: ReceiptItem[]): { category: string; amount: number; names: string[] }[] {
  const out: { category: string; amount: number; names: string[] }[] = []
  for (const it of items) {
    const g = out.find(x => x.category === it.category)
    const a = toMinor(it.amount)
    if (g) { g.amount += a; g.names.push(it.name_ro || it.name) } else out.push({ category: it.category, amount: a, names: [it.name_ro || it.name] })
  }
  return out
}
