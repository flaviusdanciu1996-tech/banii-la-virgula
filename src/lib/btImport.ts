// Banca Transilvania statement (PDF "Extras cont") → transactions, plus automatic categorisation.
// Pure functions: the PDF text is extracted in the browser (pdf.js) and passed in as positioned items.

export interface PdfItem { page: number; x: number; y: number; str: string }

export interface ParsedTx {
  ref: string // bank reference, used to avoid importing twice
  date: string // YYYY-MM-DD (card payment date when present, else posting date)
  kind: 'in' | 'out'
  amount: number // minor units in the account currency
  currency: string // account currency (EUR, RON, …)
  ron: number | null // bank's RON equivalent in bani, when the statement shows it
  title: string // first description line, e.g. "Plata la POS non-BT cu card MASTERCARD"
  merchant: string // best guess of who was paid / who paid
  original: string // e.g. "30.00 DKK" for foreign card payments
  details: string // all description lines joined
}

const SKIP = /^(RULAJ ZI|RULAJ TOTAL CONT|SOLD ANTERIOR|SOLD FINAL ZI|SOLD FINAL CONT|TOTAL DISPONIBIL|Fonduri proprii|Credit neutilizat|din care)\b/i
const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/
const AMOUNT = /^-?\d{1,3}(,\d{3})*(\.\d{1,2})?$|^-?\d+(\.\d{1,2})?$/

const toIso = (d: string) => { const m = d.match(DATE)!; return `${m[3]}-${m[2]}-${m[1]}` }
/** "4,690.93" → 469093 */
export function parseBtAmount(s: string): number {
  const clean = s.replace(/,/g, '')
  const [i, f = ''] = clean.split('.')
  return Number(i) * 100 + Number((f + '00').slice(0, 2))
}

type Line = { page: number; y: number; items: PdfItem[]; text: string }

function toLines(items: PdfItem[]): Line[] {
  const sorted = [...items].filter(i => i.str.trim()).sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)
  const lines: Line[] = []
  for (const it of sorted) {
    const last = lines[lines.length - 1]
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= 2.5) last.items.push(it)
    else lines.push({ page: it.page, y: it.y, items: [it], text: '' })
  }
  for (const l of lines) { l.items.sort((a, b) => a.x - b.x); l.text = l.items.map(i => i.str.trim()).join(' ') }
  return lines
}

export function parseBT(items: PdfItem[]): ParsedTx[] {
  const lines = toLines(items)
  const out: ParsedTx[] = []
  let currency = 'RON', debitX = 451, creditX = 545, descX = 89, lastDate = ''
  let cur: (ParsedTx & { lines: string[] }) | null = null

  const finish = () => {
    if (!cur) return
    const d = cur.lines
    cur.details = d.join(' ')
    const m = cur.details.match(/ECHIVALENT LEI\s+([\d,]+\.\d{2})/i)
    if (m) cur.ron = parseBtAmount(m[1])
    else if (cur.currency === 'RON') cur.ron = cur.amount
    const ref = cur.details.match(/REF:\s*([A-Z0-9]+)/i)
    if (ref) cur.ref = ref[1]
    const pos = cur.details.match(/POS (\d{2}\/\d{2}\/\d{4})/)
    if (pos) cur.date = toIso(pos[1])
    const orig = cur.details.match(/valoare tranzactie:\s*([\d.,]+)\s*([A-Z]{3})/i)
    if (orig) cur.original = `${orig[1]} ${orig[2]}`
    cur.merchant = guessMerchant(cur.title, cur.details)
    if (!cur.ref) cur.ref = `${cur.date}|${cur.kind}|${cur.amount}|${cur.merchant}`.slice(0, 120)
    const { lines: _l, ...tx } = cur
    out.push(tx)
    cur = null
  }

  for (const l of lines) {
    const first = l.items[0]
    if (/^Valuta$/i.test(first?.str ?? '') || l.items.some(i => i.str.trim() === 'Valuta')) continue
    if (l.items.length && /^(EUR|RON|USD|GBP|CHF)$/.test(l.items[0].str.trim()) && l.items[0].x > 200 && l.items[0].x < 320) { currency = l.items[0].str.trim(); continue }
    const dHead = l.items.find(i => i.str.trim() === 'Debit'), cHead = l.items.find(i => i.str.trim() === 'Credit')
    if (dHead && cHead) { finish(); debitX = dHead.x; creditX = cHead.x; const de = l.items.find(i => /^Descriere$/i.test(i.str.trim())); if (de) descX = de.x; continue }

    const dateItem = l.items.find(i => DATE.test(i.str.trim()) && i.x < descX - 5)
    const desc = l.items.filter(i => i.x >= descX - 4 && i.x < debitX - 60)
    const amounts = l.items.filter(i => i.x >= debitX - 60 && AMOUNT.test(i.str.trim()))
    const descText = desc.map(i => i.str.trim()).join(' ')

    if (SKIP.test(descText) || /^SUME BLOCATE|^La data curenta|^Acest extras|^BANCA TRANSILVANIA/i.test(l.text)) {
      finish()
      if (dateItem) lastDate = toIso(dateItem.str.trim())
      continue
    }
    if (dateItem) lastDate = toIso(dateItem.str.trim())

    if (amounts.length && descText) {
      finish()
      const a = amounts[amounts.length - 1]
      const mid = (debitX + creditX) / 2
      const kind: 'in' | 'out' = a.x + a.str.length * 2 < mid ? 'out' : 'in'
      cur = { ref: '', date: lastDate, kind, amount: parseBtAmount(a.str.trim()), currency, ron: null, title: descText, merchant: '', original: '', details: '', lines: [descText] }
      continue
    }
    if (cur && descText && !amounts.length && (!first || first.x >= descX - 4)) { cur.lines.push(descText); continue }
    if (cur && (!first || first.x < descX - 4) && !dateItem) finish()
  }
  finish()
  return out.filter(t => t.amount > 0)
}

/** Pull a readable merchant/counterparty name out of BT's description. */
export function guessMerchant(title: string, details: string): string {
  const pos = details.match(/TID:\S+\s+(?:\d{3,5}\s+)?(.+?)(?:\s+\d{6,}\s+valoare|\s+valoare tranzactie|;|$)/i)
  if (pos) return tidy(pos[1].replace(/\s+[A-Z]{2}$/, ''))
  const parts = details.split(';').map(s => s.trim()).filter(Boolean)
  // Transfers: "C.I.F.:…;details;…;NAME S R L;IBAN;…"
  const name = parts.find(p => /[A-Z]{3,}/.test(p) && !/^C\.I\.F|^RO\d{2}[A-Z]{4}|^BTRL|^REF|^CURS|^\d+$|^\/|\d{6,}|^[A-Z]{4}RO[A-Z0-9]{2,5}$/.test(p) && /\s/.test(p) && p.length > 3 && p !== title)
  if (/Constituire depozit/i.test(title)) return 'Depozit BT'
  if (/Desfiintare depozit|Lichidare depozit/i.test(title)) return 'Depozit BT închis'
  if (/unitati de fond|Colectare automata fonduri/i.test(title)) return 'Fond BT Asset Management'
  if (/Retragere/i.test(title)) return 'Retragere numerar'
  if (/Comision|Taxa/i.test(title)) return 'Comision bancar'
  return tidy(name || title)
}
const short = (s: string) => { const w: string[] = []; for (const x of s.split(/\s+/)) { if ((w.length && /\d/.test(x)) || w.length >= 3) break; w.push(x) } return w.length ? w.join(' ') : s }
const tidy = (s: string) => short(s).replace(/\s{2,}/g, ' ').replace(/\b(\w)(\w*)/g, (_, a, b) => a.toUpperCase() + b.toLowerCase()).trim().slice(0, 60)

/* ---------------- Categorisation ---------------- */

/** Keyword → default category name. First match wins; learned rules are checked before these. */
export const KEYWORDS: [RegExp, string][] = [
  [/constituire depozit|depunere economii/i, 'Economii'],
  [/unitati de fond|colectare automata fonduri|cv unit\.|pensia mea|pensii facultative|fond de pensii|pilon ?(3|iii)/i, 'Investiții'],
  [/\b(tankstelle|tankstation|autohof|truck ?stop|benzin\w*|fuel|shell|omv|petrom|mol|lukoil|rompetrol|socar|st1|circle ?k|aral|total|esso|q8|bp |eni|agip|orlen|jet |avia|tamoil|repsol|ok benzin|preem|ingo|uno-x|statoil|gulf|dkv|as24)\b/i, 'Combustibil'],
  [/\b(lidl|kaufland|carrefour|mega ?image|profi|penny|auchan|aldi|netto|rewe|edeka|city gross|ica |coop|willys|hemk[oö]p|spar|billa|tesco|lidl|selgros|metro|cora|la doi pasi|rema 1000|kiwi|meny|bunnpris|norma|plus |jumbo|albert heijn|biedronka|intermarche|leclerc|mercadona|conad|esselunga|migros|hofer|penny)\b/i, 'Mâncare acasă'],
  [/\b(mcdonald|kfc|burger king|starbucks|subway|pizza|restaurant|bistro|cafe|caf[eé]|coffee|kebab|grill|trattoria|pub|bar |sushi|glovo|tazz|bolt food|wolt|foodpanda|max hamburgare|espresso house|rasthof|autogrill)\b/i, 'Restaurante & cafenele'],
  [/\b(peaj|rovinieta|vignette|vinieta|maut|toll|brobizz|storebaelt|oresund|[oø]resund|autobahn|autostrad|parcare|parking|parkering|easypark|telepass|via verde|asfinag|hu-go|emyto|e-tag|bilet|cfr|uber|bolt|taxi|metrorex|stb|ratb|ferry|f[aä]hr\w*|fahrhaf\w*|faehr\w*|scandlines|stena|ttline|flixbus)\b/i, 'Transport'],
  [/\b(orange|vodafone|digi|rcs|telekom|lycamobile|telia|tre |o2)\b/i, 'Telefon & internet'],
  [/\b(netflix|spotify|youtube|google|apple\.com|icloud|disney|hbo|max\.com|amazon prime|prime video|voyo|chatgpt|openai|claude|anthropic|microsoft|adobe|canva|lovable)\b/i, 'Abonamente'],
  [/\b(farmaci|pharma|apotek|apotheke|catena|dr\.? ?max|help ?net|sensiblu|benu|clinica|medic|regina maria|medlife|synevo|dentist|stomatolog)\b/i, 'Sănătate'],
  [/\b(enel|e\.on|eon|electrica|engie|hidroelectrica|ppc|apa nova|compania de apa|aquatim|salubris|gaz|utilitati)\b/i, 'Utilități'],
  [/\b(zara|h&m|h & m|pepco|kik|lc waikiki|reserved|deichmann|decathlon|about you|shein|zalando|sportisimo|intersport)\b/i, 'Haine'],
  [/\b(emag|dedeman|ikea|jysk|leroy|hornbach|brico|altex|flanco|mathaus|praktiker|amazon)\b/i, 'Cumpărături diverse'],
  [/\b(cinema|cinema city|steam|playstation|xbox|bilete|iabilet|eventim|casino|superbet|betano|unibet|netbet|fortuna)\b/i, 'Distracție'],
  [/\b(allianz|groupama|omniasig|generali|asirom|euroins|city insurance|grawe|signal iduna|rca|asigur)\b/i, 'Asigurări'],
  [/\b(sala|gym|fitness|world class|7card|frizer|barber|salon|cosmetic|dm drogerie|douglas|notino|sephora)\b/i, 'Îngrijire personală & sport'],
  [/retragere|atm/i, 'Cumpărături diverse'],
  [/comision|taxa administrare|taxa lunara/i, 'Cumpărături diverse'],
]

export const INCOME_KEYWORDS: [RegExp, string][] = [
  [/salariu|salar|wage|salary/i, 'Salariu'],
  [/decont|diurna|diurnă|deplasare/i, 'Diurnă'],
  [/bonus|prima/i, 'Bonus'],
]

export interface Rule { pattern: string; category_id: string | null; skip?: boolean }

/** Money moved between the user's own accounts: not an expense or income. Learned rule first, then the bank's wording. */
export function isOwnTransfer(tx: ParsedTx, rules: Rule[]): boolean {
  const key = merchantKey(tx.merchant)
  const r = key ? rules.find(x => x.pattern === key && (x.skip || x.category_id)) : undefined
  if (r) return !!r.skip
  return /transfer intern|intre conturi proprii|între conturi proprii|transfer propriu|desfiintare depozit|lichidare depozit|schimb valutar/i.test(`${tx.merchant} ${tx.title} ${tx.details}`)
}

/** A short, safe clue from the bank's details (who/what was paid), without IBANs, personal codes or bank references. */
export function detailHint(tx: ParsedTx): string {
  return tx.details.replace(tx.title, '').replace(/^\s*-?\s*canal electronic/i, '')
    .replace(/RO\d{2}[A-Z]{4}[0-9A-Z]{10,16}/g, '')
    .replace(/\/ROC\/[^;]*/g, '')
    .replace(/\b\d{13}\b/g, '')
    .replace(/REF:?\s*\S+/gi, '')
    .replace(/\b[A-Z]{4}RO[A-Z0-9]{2,5}\b/g, '')
    .replace(/C\.I\.F\.?:?\s*\d+/gi, '')
    .split(/[;\n]/).map(x => x.trim()).filter(x => x.length > 2 && !/^[A-Za-z0-9]{2,5}$/.test(x)).join(' · ')
    .replace(/\s{2,}/g, ' ').trim().slice(0, 140)
}

/** Normalised key used to remember the user's choice for a merchant. */
export const merchantKey = (m: string) => m.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').split(/\s+/).filter(w => w.length > 1).slice(0, 2).join(' ')

export function categorize(tx: ParsedTx, rules: Rule[], cats: { id: string; name: string; kind: string; archived: boolean }[]): string | null {
  const key = merchantKey(tx.merchant)
  const learned = key ? rules.find(r => r.pattern === key && !r.skip && cats.some(c => c.id === r.category_id && c.kind === tx.kind)) : undefined
  if (learned?.category_id) return learned.category_id
  const byName = (n: string) => cats.find(c => c.name === n && c.kind === tx.kind && !c.archived)?.id ?? null
  const hay = `${tx.merchant} ${tx.title} ${tx.details}`
  for (const [re, name] of tx.kind === 'in' ? INCOME_KEYWORDS : KEYWORDS) if (re.test(hay)) { const id = byName(name); if (id) return id }
  if (tx.kind === 'in') return byName('Alte venituri')
  return null
}
