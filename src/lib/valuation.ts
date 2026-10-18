// Value of things that lose value over time (phone, car, laptop). Pure functions, no imports:
// the same file is deployed with the `asset-value` edge function.
// Money is in minor units (bani / cents).

export interface Offer { title: string; price: number; currency: string; source: string; url: string; used?: boolean }
export interface ValuePoint { day: string; value: number; source: string }

/** Fractional months between two ISO days (b after a → positive). */
export function monthsBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  return (y2 - y1) * 12 + (m2 - m1) + (d2 - d1) / 30.44
}

/** Compound loss of `ratePct` per year over `months`. */
export function depreciate(value: number, ratePct: number, months: number): number {
  if (!ratePct || months <= 0) return value
  return Math.round(value * Math.pow(1 - ratePct / 100, months / 12))
}

/** Round to whole lei (or euro) — estimates with bani look falsely precise. */
export const roundWhole = (v: number) => Math.round(v / 100) * 100

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  if (!s.length) return 0
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

export const MIN_OFFERS = 5

/**
 * Market value from second-hand listings. Prices are converted into `cur` with `rates` (lei per unit),
 * listings far from the median (wrong model, broken, typo) are dropped, then the median is reduced by
 * `discountPct` (asking price → what it actually sells for). Null when fewer than MIN_OFFERS remain.
 */
export function marketValue(offers: Offer[], cur: string, rates: Record<string, number>, discountPct: number):
  { value: number; median: number; offers: Offer[]; count: number } | null {
  const toCur = (o: Offer) => {
    const c = (o.currency || 'RON').toUpperCase()
    const lei = c === 'RON' || c === 'LEI' ? o.price : rates[c] ? o.price * rates[c] : NaN
    const v = cur === 'RON' ? lei : rates[cur] ? lei / rates[cur] : NaN
    return Math.round(v * 100)
  }
  const priced = offers.map(o => ({ o, v: toCur(o) })).filter(x => Number.isFinite(x.v) && x.v > 0)
  if (!priced.length) return null
  const m0 = median(priced.map(x => x.v))
  const kept = priced.filter(x => x.v >= m0 * 0.6 && x.v <= m0 * 1.6)
  const marked = offers.map(o => ({ ...o, used: kept.some(k => k.o === o) }))
  if (kept.length < MIN_OFFERS) return null
  const m = median(kept.map(x => x.v))
  return { value: roundWhole(m * (1 - discountPct / 100)), median: m, offers: marked, count: kept.length }
}

/** Latest real value we know (purchase, a manual correction or a market check) — depreciation runs from it. */
export function anchorPoint(history: ValuePoint[], purchase?: { value: number | null; day: string | null }): ValuePoint | null {
  const real = history.filter(p => p.source !== 'depreciation').sort((a, b) => a.day.localeCompare(b.day))
  const last = real[real.length - 1] ?? null
  const p = purchase?.value && purchase.day ? { day: purchase.day, value: Number(purchase.value), source: 'purchase' } : null
  if (!last) return p
  if (p && p.day > last.day) return p
  return { ...last, value: Number(last.value) }
}

/** Estimated value on `day` by depreciating from the anchor. */
export function estimateOn(day: string, ratePct: number, anchor: ValuePoint | null): number | null {
  if (!anchor) return null
  return roundWhole(depreciate(anchor.value, ratePct, monthsBetween(anchor.day, day)))
}

/** True when a month has passed since the last check (or it was never checked). */
export function checkDue(lastChecked: string | null, today: string): boolean {
  if (!lastChecked) return true
  const [y, m, d] = lastChecked.split('-').map(Number)
  const next = new Date(Date.UTC(y, m, d)) // same day next month (overflow rolls forward)
  return today >= next.toISOString().slice(0, 10)
}

/** Default yearly loss per kind of good, in %. */
export const DEFAULT_DEP: Record<string, number> = { electronice: 35, masina: 15, alte_bunuri: 20 }

/* ---------- Reading listings (OLX, Publi24) ---------- */

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/(\d)\s+(gb|tb)\b/g, '$1$2').replace(/\b([a-z])\s+(\d{1,3})\b/g, '$1$2')
  .replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, ' ').trim()

const GENERIC = new Set(['samsung', 'galaxy', 'telefon', 'mobil', 'smartphone', 'apple', 'xiaomi', 'huawei', 'second', 'hand', 'folosit'])
const VARIANTS = ['ultra', 'plus', 'pro', 'max', 'mini', 'lite', 'fe', 'edge', 'fold', 'flip']
const BAD = ['defect', 'spart', 'sparta', 'fisurat', 'piese', 'blocat', 'icloud', 'cutie goala', 'cumpar', 'caut ', 'inchiriez', 'nefunctional', 'placa de baza', 'pentru piese']
const ACCESSORY = ['husa', 'huse', 'folie', 'carcasa', 'cablu', 'incarcator', 'baterie', 'display', 'ecran', 'cutie']

/** Does a listing title look like exactly the thing in `query` (same model, variant and memory)? */
export function matchesQuery(title: string, query: string, extra = ''): boolean {
  const t = ' ' + norm(title) + ' '
  const more = ' ' + norm(extra).slice(0, 400) + ' '
  if (BAD.some(b => t.includes(' ' + b))) return false
  if (ACCESSORY.some(a => t.startsWith(' ' + a + ' '))) return false
  const q = norm(query).split(' ').filter(w => w && !GENERIC.has(w))
  for (const w of q) {
    const isMem = /^\d+(gb|tb)$/.test(w)
    if (!t.includes(' ' + w + ' ') && !(isMem && more.includes(' ' + w + ' '))) return false
  }
  // A variant in the title that the query doesn't have ("S25 Ultra" vs "S25 Plus", "Pro" vs "Pro Max").
  for (const v of VARIANTS) if (t.includes(' ' + v + ' ') && !q.includes(v)) return false
  // A different memory size in the title.
  const qMem = q.filter(w => /^\d+(gb|tb)$/.test(w))
  if (qMem.length) {
    const tMem = (t.match(/ \d+(gb|tb) /g) ?? []).map(x => x.trim()).filter(m => !/^(4|6|8|12|16|24)gb$/.test(m)) // RAM sizes are fine
    if (tMem.some(m => !qMem.includes(m))) return false
  }
  return true
}

export const olxUrl = (q: string, page = 1) => `https://www.olx.ro/oferte/q-${encodeURIComponent(norm(q).replace(/ /g, '-'))}/${page > 1 ? `?page=${page}` : ''}`
export const publi24Url = (q: string) => `https://www.publi24.ro/anunturi/?q=${encodeURIComponent(q).replace(/%20/g, '+')}`

/** OLX keeps the search results as JSON inside window.__PRERENDERED_STATE__. */
export function parseOlx(html: string): (Offer & { extra: string; isNew: boolean })[] {
  const m = html.match(/__PRERENDERED_STATE__\s*=\s*("(?:[^"\\]|\\.)*")/)
  if (!m) return []
  let state: any
  try { state = JSON.parse(JSON.parse(m[1])) } catch { return [] }
  const ads: any[] = state?.listing?.listing?.ads ?? []
  return ads.map(ad => {
    const rp = ad.price?.regularPrice ?? {}
    const cond = (ad.params ?? []).find((x: any) => x.key === 'state')
    const condText = norm(String(cond?.normalizedValue ?? cond?.value ?? ad.itemCondition ?? ''))
    return {
      title: String(ad.title ?? ''), url: String(ad.url ?? ''), source: 'OLX',
      price: ad.price?.exchange || ad.price?.free ? 0 : Number(rp.value ?? 0), currency: String(rp.currencyCode ?? 'RON').toUpperCase(),
      extra: String(ad.description ?? '').replace(/<[^>]+>/g, ' '),
      isNew: condText === 'new' || condText === 'nou' || NEW_RX.test(norm(ad.title ?? '')),
    }
  }).filter(o => o.price > 0)
}

const NEW_RX = /\b(sigilat|sigilata|produs nou|nou nout|nou in cutie sigilata|brand new)\b/

/** Publi24 lists the results as schema.org ItemList (JSON-LD). */
export function parsePubli24(html: string): (Offer & { extra: string; isNew: boolean })[] {
  const out: (Offer & { extra: string; isNew: boolean })[] = []
  for (const block of html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? []) {
    try {
      // Publi24 leaves raw line breaks inside strings; as whitespace they're harmless everywhere else.
      const j = JSON.parse(block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '').replace(/[\u0000-\u001f]+/g, ' '))
      for (const it of j.itemListElement ?? []) {
        const price = Number(it?.offers?.price)
        if (!price) continue
        const url = String(it.url ?? '')
        out.push({ title: String(it.name ?? ''), url: url.startsWith('http') ? url : 'https://www.publi24.ro/' + url.replace(/^\//, ''), source: 'Publi24',
          price, currency: String(it?.offers?.priceCurrency ?? 'RON').toUpperCase(), extra: String(it.description ?? ''), isNew: NEW_RX.test(norm(String(it.name ?? ''))) })
      }
    } catch { /* not the list */ }
  }
  return out
}

/** Second-hand listings matching the query, deduplicated, cheapest-first mix capped at `max`. */
export function pickOffers(all: (Offer & { extra: string; isNew: boolean })[], query: string, max = 20): Offer[] {
  const seen = new Set<string>()
  const ok: Offer[] = []
  for (const o of all) {
    if (o.isNew || !matchesQuery(o.title, query, o.extra)) continue
    const key = o.url || o.title + o.price
    if (seen.has(key)) continue
    seen.add(key)
    ok.push({ title: o.title.slice(0, 120), price: o.price, currency: o.currency === 'LEI' ? 'RON' : o.currency, source: o.source, url: o.url })
  }
  return ok.slice(0, max)
}
