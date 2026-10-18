import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMoney, fmt, toRon } from './money.ts'
import { periodFor, shiftPeriod, periodLabel, daysLeft, daysElapsed } from './period.ts'
import { summarize, netWorth, streak, points, savingsRate } from './calc.ts'
import type { Category, Tx, Asset } from './types.ts'

test('parseMoney', () => {
  assert.equal(parseMoney('23,50'), 2350)
  assert.equal(parseMoney('1.234,50'), 123450)
  assert.equal(parseMoney('12'), 1200)
  assert.equal(parseMoney('1.234'), 123400)
  assert.equal(parseMoney('0,05'), 5)
  assert.equal(parseMoney('10,5'), 1050)
  assert.equal(parseMoney('1 234,56 lei'), 123456)
  assert.equal(parseMoney('12,345'), null)
  assert.equal(parseMoney('abc'), null)
  assert.equal(parseMoney(''), null)
  assert.equal(parseMoney('0,1'), 10)
  assert.equal(parseMoney('19,99'), 1999) // no float drift
})

test('fmt', () => {
  assert.equal(fmt(123450), '1.234,50 lei')
  assert.equal(fmt(5), '0,05 lei')
  assert.equal(fmt(1000, 'EUR'), '10,00 €')
})

test('periods', () => {
  assert.deepEqual(periodFor('2026-10-18', 1), { start: '2026-10-01', end: '2026-10-31' })
  assert.deepEqual(periodFor('2026-10-18', 15), { start: '2026-10-15', end: '2026-11-14' })
  assert.deepEqual(periodFor('2026-10-10', 15), { start: '2026-09-15', end: '2026-10-14' })
  // payday 31 clamps in short months
  assert.deepEqual(periodFor('2026-02-28', 31), { start: '2026-02-28', end: '2026-03-30' })
  assert.deepEqual(periodFor('2026-03-15', 31), { start: '2026-02-28', end: '2026-03-30' })
  assert.deepEqual(periodFor('2026-03-31', 31), { start: '2026-03-31', end: '2026-04-29' })
  const p = periodFor('2026-12-20', 15)
  assert.deepEqual(shiftPeriod(p, 1, 15), { start: '2027-01-15', end: '2027-02-14' })
  assert.deepEqual(shiftPeriod(p, -12, 15), { start: '2025-12-15', end: '2026-01-14' })
  assert.equal(periodLabel(periodFor('2026-10-18', 1), 1), 'Octombrie 2026')
  assert.equal(periodLabel(periodFor('2026-10-18', 15), 15), '15 oct – 14 nov 2026')
  const oct = periodFor('2026-10-18', 1)
  assert.equal(daysLeft(oct, '2026-10-18'), 13)
  assert.equal(daysElapsed(oct, '2026-10-18'), 18)
})

const cats: Category[] = [
  { id: 'food', household_id: 'h', name: 'Mâncare', kind: 'out', grp: 'critic', icon: 'x', allocated: 100000, archived: false, sort: 0 },
  { id: 'fun', household_id: 'h', name: 'Distracție', kind: 'out', grp: 'optional', icon: 'x', allocated: 50000, archived: false, sort: 1 },
  { id: 'sav', household_id: 'h', name: 'Economii', kind: 'out', grp: 'economii', icon: 'x', allocated: 200000, archived: false, sort: 2 },
  { id: 'sal', household_id: 'h', name: 'Salariu', kind: 'in', grp: null, icon: 'x', allocated: 0, archived: false, sort: 3 },
]
const tx = (id: string, kind: 'in' | 'out', amount: number, cat: string, date: string, member = 'u1', created = date + 'T10:00:00'): Tx =>
  ({ id, household_id: 'h', member_id: member, kind, amount, category_id: cat, note: '', date, created_at: created, asset_id: null })

test('summary and budget', () => {
  const txs = [tx('1', 'in', 1500000, 'sal', '2026-10-01'), tx('2', 'out', 60000, 'food', '2026-10-05'), tx('3', 'out', 100000, 'sav', '2026-10-06'), tx('4', 'out', 999, 'food', '2026-09-30')]
  const s = summarize(txs, cats, null, periodFor('2026-10-18', 1), '2026-10-18')
  assert.equal(s.income, 1500000)
  assert.equal(s.spent, 60000)
  assert.equal(s.saved, 100000)
  assert.equal(s.totalBudget, 150000) // economii excluded
  assert.equal(s.left, 90000)
  assert.equal(s.spentPct, 40)
  const o = summarize(txs, cats, { household_id: 'h', payday: 1, total_budget: 300000, savings_target_pct: 20, eur_rate: 5, usd_rate: 4.5, rates_date: null }, periodFor('2026-10-18', 1), '2026-10-18')
  assert.equal(o.totalBudget, 300000)
  assert.equal(savingsRate(1500000, 60000), 96)
})

test('net worth and conversion', () => {
  const rates = { EUR: 4.9761, USD: 4.3 }
  assert.equal(toRon(10000, 'EUR', rates), 49761)
  const a = (id: string, kind: string, value: number, currency: 'RON' | 'EUR' | 'USD', invested = 0): Asset =>
    ({ id, household_id: 'h', owner_id: 'u1', name: id, kind, platform: '', currency, value, invested, note: '', updated_on: '2026-10-18', archived: false })
  const nw = netWorth([a('rev', 'cont_bancar', 500000, 'RON'), a('btc', 'crypto', 100000, 'EUR', 80000), a('car', 'masina', 2000000, 'EUR'), a('leas', 'leasing', 300000, 'RON')], rates)
  assert.equal(nw.liquid, 500000)
  assert.equal(nw.invest, 497610)
  assert.equal(nw.invested, 398088)
  assert.equal(nw.goods, 9952200)
  assert.equal(nw.debts, 300000)
  assert.equal(nw.net, 500000 + 497610 + 9952200 - 300000)
})

test('streak and points', () => {
  const txs = ['2026-10-16', '2026-10-17', '2026-10-18'].map((d, i) => tx('s' + i, 'out', 100, 'food', d))
  assert.equal(streak(['2026-10-16', '2026-10-17', '2026-10-18'], '2026-10-18'), 3)
  assert.equal(streak(['2026-10-16', '2026-10-17'], '2026-10-18'), 2)
  assert.equal(streak(['2026-10-15'], '2026-10-18'), 0)
  assert.equal(points(txs, 'u1'), 3)
  const week = Array.from({ length: 7 }, (_, i) => tx('w' + i, 'out', 1, 'food', `2026-10-0${i + 1}`))
  assert.equal(points(week, 'u1'), 7 + 10)
})

import { occurrences, nextOccurrence, duePostings, monthlyNeeded } from './schedule.ts'

test('recurring dates', () => {
  assert.deepEqual(occurrences(31, '2026-01-15', '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  assert.deepEqual(occurrences(5, '2026-10-06', '2026-10-31'), [])
  assert.equal(nextOccurrence(15, '2026-10-18'), '2026-11-15')
  assert.equal(nextOccurrence(20, '2026-10-18'), '2026-10-20')
  assert.equal(nextOccurrence(31, '2026-02-10'), '2026-02-28')
  assert.deepEqual(duePostings(10, '2026-08-01', '2026-09-10', '2026-10-18'), ['2026-10-10'])
  assert.deepEqual(duePostings(10, '2026-10-18', null, '2026-10-18'), [])
  assert.deepEqual(duePostings(18, '2026-10-18', null, '2026-10-18'), ['2026-10-18'])
})

test('goal maths', () => {
  assert.equal(monthlyNeeded(5000000, 1000000, '2026-10-18', '2028-10-18'), Math.ceil(4000000 / 24))
  assert.equal(monthlyNeeded(100000, 100000, '2026-10-18', '2027-01-01'), 0)
  assert.equal(monthlyNeeded(100000, 0, '2026-10-18', null), null)
  assert.equal(monthlyNeeded(100000, 0, '2026-10-18', '2026-10-01'), 100000)
})

import { parseBT, categorize, parseBtAmount } from './btImport.ts'

test('BT statement parsing and categories', () => {
  assert.equal(parseBtAmount('4,690.93'), 469093)
  const P = (y: number, x: number, str: string) => ({ page: 1, x, y, str })
  const items = [
    P(625, 261, 'Valuta'), P(613, 266, 'EUR'),
    P(597, 22, 'Data'), P(597, 89, 'Descriere'), P(597, 451, 'Debit'), P(597, 545, 'Credit'),
    P(583, 89, 'SOLD ANTERIOR'), P(583, 554, '71.02'),
    P(567, 28, '13/10/2026'), P(568, 90, 'Plata la POS non-BT cu card MASTERCARD'), P(568, 466, '4.01'),
    P(558, 90, 'POS 10/10/2026 9084773 TID:37C31301 1301 Shell Service Fynske Motorvej'),
    P(547, 90, '531B Vissenbjerg DK 54956535 valoare tranzactie: 30.00 DKK RRN:'),
    P(537, 90, 'CURS 5.3373 RON ECHIVALENT LEI 21.40'),
    P(527, 90, 'REF: 000TEST1'),
    P(517, 90, 'Plata la POS non-BT cu card MASTERCARD'), P(517, 460, '10.50'),
    P(507, 90, 'POS 13/10/2026 0802199 TID:20029309 City Gross Attekulla RUSTHALLSG 43 Helsingborg SE 54956535'),
    P(497, 90, 'valoare tranzactie: 117.40 SEK RRN:1 comision tranzactie 0.00 EUR; X;'),
    P(487, 90, 'CURS 5.3393 RON ECHIVALENT LEI 56.06'),
    P(477, 90, 'REF: 000TEST2'),
    P(467, 28, '14/10/2026'), P(467, 90, 'Incasare valutara - canal electronic'), P(467, 545, '880.00'),
    P(457, 90, 'C.I.F.:1;decont 1 septembrie;1894;FIRMA TRANSPORT S R L;RO23BTRL;'),
    P(447, 90, 'REF: 000TEST3'),
    P(437, 28, '14/10/2026'), P(437, 89, 'RULAJ ZI'), P(437, 456, '14.51'), P(437, 543, '880.00'),
  ]
  const txs = parseBT(items)
  assert.equal(txs.length, 3)
  assert.deepEqual(txs.map(t => [t.date, t.kind, t.amount, t.ron, t.ref]), [
    ['2026-10-10', 'out', 401, 2140, '000TEST1'],
    ['2026-10-13', 'out', 1050, 5606, '000TEST2'],
    ['2026-10-14', 'in', 88000, null, '000TEST3'],
  ])
  assert.equal(txs[0].original, '30.00 DKK')
  const cats = [{ id: 'f', name: 'Combustibil', kind: 'out', archived: false }, { id: 'm', name: 'Mâncare acasă', kind: 'out', archived: false }, { id: 'd', name: 'Diurnă', kind: 'in', archived: false }]
  assert.deepEqual(txs.map(t => categorize(t, [], cats)), ['f', 'm', 'd'])
  assert.equal(categorize(txs[1], [{ pattern: 'city gross', category_id: 'f' }], cats), 'f') // learned rule wins
})

import { matchReceipt, splitProportional, receiptForImport, pendingReceipts, groupItems } from './receipt.ts'

test('receipts: matching and splitting', () => {
  const base = (o: Partial<Tx>): Tx => ({ id: 'x', household_id: 'h', member_id: 'u', kind: 'out', amount: 1601, category_id: 'fuel', note: 'Aral', date: '2026-10-14', created_at: '', asset_id: null, ...o })
  const aral = base({ id: 'a', orig_amount: 300, orig_currency: 'EUR', orig_note: '3.00 EUR', import_ref: 'R1' })
  const shell = base({ id: 's', amount: 2140, orig_amount: 401, orig_currency: 'EUR', orig_note: '30.00 DKK', import_ref: 'R2', date: '2026-10-10' })
  assert.equal(matchReceipt({ total: 300, currency: 'EUR', date: '2026-10-14' }, [aral, shell])?.id, 'a')
  assert.equal(matchReceipt({ total: 3000, currency: 'DKK', date: '2026-10-11' }, [aral, shell])?.id, 's')
  assert.equal(matchReceipt({ total: 300, currency: 'EUR', date: '2026-10-25' }, [aral]), null)
  assert.deepEqual(splitProportional(1601, [100, 200]), [534, 1067])
  assert.equal(splitProportional(999, [1, 1, 1]).reduce((a, b) => a + b, 0), 999)
  const pend = pendingReceipts([base({ id: 'p1', receipt_id: 'rc', receipt_total: 3000, receipt_currency: 'DKK', date: '2026-10-10' })])
  assert.equal(receiptForImport({ date: '2026-10-10', amount: 401, currency: 'EUR', original: '30.00 DKK' }, pend)?.receipt_id, 'rc')
  assert.deepEqual(groupItems([{ name: 'WC', amount: 1, category: 'WC & dușuri' }, { name: 'Kaffee', amount: 2.5, category: 'Restaurante & cafenele' }, { name: 'Dusche', amount: 4, category: 'WC & dușuri' }]).map(g => [g.category, g.amount]), [['WC & dușuri', 500], ['Restaurante & cafenele', 250]])
})

import { depreciate, marketValue, anchorPoint, estimateOn, checkDue, monthsBetween } from './valuation.ts'

test('phone loses ~35%/year: 4.000 lei in July 2026 → ~2.500 in August 2027', () => {
  const a = anchorPoint([], { value: 400000, day: '2026-07-15' })
  assert.ok(Math.abs(estimateOn('2027-08-15', 35, a)! - 250000) <= 2000)
  assert.equal(depreciate(400000, 0, 12), 400000)
  assert.ok(Math.abs(monthsBetween('2026-07-15', '2027-01-15') - 6) < 0.01)
})

test('manual correction becomes the new starting point', () => {
  const a = anchorPoint([{ day: '2026-12-01', value: 350000, source: 'manual' }, { day: '2027-01-01', value: 340000, source: 'depreciation' }], { value: 400000, day: '2026-07-15' })
  assert.equal(a!.value, 350000)
})

test('market value: median of ≥5 listings, outliers dropped, minus discount', () => {
  const o = (price: number, currency = 'RON') => ({ title: 'S25 Ultra', price, currency, source: 'OLX', url: 'https://x' })
  const r = marketValue([o(3500), o(3600), o(3700), o(3800), o(760, 'EUR'), o(900), o(9000)], 'RON', { EUR: 5 }, 10)!
  assert.equal(r.count, 5)
  assert.equal(r.median, 370000)
  assert.equal(r.value, 333000)
  assert.equal(marketValue([o(3500), o(3600), o(3700)], 'RON', {}, 10), null)
})

test('monthly check is due one month after the last one', () => {
  assert.equal(checkDue(null, '2026-10-18'), true)
  assert.equal(checkDue('2026-10-01', '2026-10-31'), false)
  assert.equal(checkDue('2026-10-01', '2026-11-01'), true)
})

import { matchesQuery, pickOffers } from './valuation.ts'

test('listing titles: same model, variant and memory only', () => {
  const q = 'Samsung Galaxy S25 Ultra 512GB'
  assert.equal(matchesQuery('Samsung Galaxy S25 ULTRA 5G 512Gb/Baterie99%', q), true)
  assert.equal(matchesQuery('Samsung S25 Ultra 512 GB Titanium, 12GB RAM', q), true)
  assert.equal(matchesQuery('Samsung S25 Ultra 256GB', q), false)
  assert.equal(matchesQuery('Samsung S25+ 512GB', q), false)
  assert.equal(matchesQuery('Samsung S24 Ultra 512GB', q), false)
  assert.equal(matchesQuery('S25 Ultra 512GB display spart', q), false)
  assert.equal(matchesQuery('Samsung S25 Ultra impecabil', q, 'Memorie 512 GB, baterie 98%'), true)
  assert.equal(matchesQuery('iPhone 15 Pro Max 256GB', 'iPhone 15 Pro 256GB'), false)
  assert.equal(matchesQuery('Husa Samsung S25 Ultra 512GB', q), false)
  assert.equal(matchesQuery('Samsung Galaxy S 25 Ultra 512 GB', q), true)
  assert.equal(matchesQuery('S25 Ultra 512GB display impecabil', q), true)
  const offers = pickOffers([
    { title: 'S25 Ultra 512GB', price: 3700, currency: 'RON', source: 'OLX', url: 'u1', extra: '', isNew: false },
    { title: 'S25 Ultra 512GB', price: 3700, currency: 'RON', source: 'OLX', url: 'u1', extra: '', isNew: false },
    { title: 'S25 Ultra 512GB sigilat', price: 5200, currency: 'RON', source: 'OLX', url: 'u2', extra: '', isNew: true },
  ], q)
  assert.equal(offers.length, 1)
})

import { parseOlx, parsePubli24 } from './valuation.ts'

test('reads OLX and Publi24 result pages', () => {
  const state = { listing: { listing: { ads: [
    { title: 'Samsung Galaxy S25 Ultra 512GB', url: 'https://www.olx.ro/d/1', price: { regularPrice: { value: 3500, currencyCode: 'RON' } }, params: [{ key: 'state', value: 'Utilizat', normalizedValue: 'used' }] },
    { title: 'Produs Nou Samsung S25 Ultra 512GB', url: 'https://www.olx.ro/d/2', price: { regularPrice: { value: 4700, currencyCode: 'RON' } }, params: [{ key: 'state', value: 'Nou' }] },
  ] } } }
  const html = `<script>window.__PRERENDERED_STATE__= ${JSON.stringify(JSON.stringify(state))};</script>`
  const o = parseOlx(html)
  assert.equal(o.length, 2); assert.equal(o[0].price, 3500); assert.equal(o[0].isNew, false); assert.equal(o[1].isNew, true)
  const p24 = '<script type="application/ld+json">{"itemListElement":[{"name":"S25 Ultra 512GB","description":"linia 1\nlinia 2","url":"anunturi/x.html","offers":{"price":"3750.00","priceCurrency":"RON"}}]}</script>'
  const p = parsePubli24(p24.replace('\\n', '\n'))
  assert.equal(p.length, 1); assert.equal(p[0].price, 3750); assert.equal(p[0].url, 'https://www.publi24.ro/anunturi/x.html')
})

import { parseTradeville, summarize as tvSummarize, num as tvNum, parseWhen } from './tradeville.ts'
import { parseBvbPrice } from './bvb.ts'

test('Tradeville activity report: saved page (.mht) → portfolio at average cost', () => {
  const rows = [
    ['10/22/21 23:19:53', 'in', 'RON', '', '3,000.00', '', '3,000.00', '', '', '', 'DEPUNERE CONT CLIENT Pret dirty:'],
    ['10/25/21 10:00:18', 'cump', 'ABC', '10.00', '100', '2.00', '-1,002.00', '', '', '0.10', 'Pret dirty:'],
    ['10/26/21 10:00:18', 'cump', 'ABC', '12.00', '100', '2.00', '-1,202.00', '', '', '0.10', 'Pret dirty:'],
    ['01/10/22 10:00:00', 'vanz', 'ABC', '15.00', '50', '1.50', '748.50', '197.50', '', '0.00', 'Pret dirty:'],
    ['02/18/22 11:44:40', 'div', 'RON', '', '19.94', '', '19.94', '', '', '', 'dividend ABC Pret dirty:'],
    ['07/14/22 09:01:06', 'in', 'ABC', '0.0000', '15', '', '0.00', '', '', '0.00', 'mcs gratuite Pret dirty:'],
    ['08/18/22 09:00:00', 'out', 'ABC', '', '165', '', '0.00', '', '', '0.00', 'Consolidare (raport 1/5) Pret dirty:'],
    ['08/18/22 09:00:46', 'in', 'ABC', '0', '33', '', '0.00', '', '', '0.00', 'Consolidare (raport 1/5) Pret dirty:'],
    ['04/05/23 07:32:51', 'out', 'RON', '', '500.00', '', '-500.00', '', '', '0.00', 'RETRAGERE CONT CLIENT X1AB12.RO Pret dirty:'],
  ]
  const head = ['Data', 'Oper', 'Ticker', 'Pret', 'Cantitate', 'comision', 'Valoare net', 'Profit/Pierdere', 'Impozit', 'taxa piata', 'Observatii / nrtz']
  const html = `<html><body><table><tr>${head.map(h => `<td>${h}</td>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>
    <table><tr><td><span>Sold final bani</span>:<b>1,064.44</b> <b>RON</b></td></tr></table></body></html>`
  const mht = `From: <Saved by Blink>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/related;\r\n\tboundary="----B----"\r\n\r\n------B----\r\nContent-Type: text/html\r\nContent-Transfer-Encoding: binary\r\n\r\n${html}\r\n------B------\r\n`
  const rep = parseTradeville(new TextEncoder().encode(mht))
  assert.equal(rep.rows.length, 9)
  assert.equal(rep.cashEnd, 106444)
  assert.equal(rep.rows[8].note, 'Retragere')
  const { holdings, summary } = tvSummarize(rep.rows)
  assert.equal(summary.deposits, 300000); assert.equal(summary.withdrawals, 50000)
  assert.equal(summary.dividends, 1994); assert.equal(summary.realized, 19750)
  assert.deepEqual(holdings.map(h => [h.symbol, h.qty]), [['ABC', 33]])
  assert.equal(holdings[0].cost, 165300) // 150 shares at 11,02 average; free shares and the 1:5 consolidation keep the cost
  assert.equal(summary.cash, 106444)
})

test('Tradeville numbers, dates and BVB price', () => {
  assert.equal(tvNum('1,128.03'), 1128.03); assert.equal(tvNum('2,696'), 2696); assert.equal(tvNum('35,9800'), 35.98); assert.equal(tvNum('1.234,5'), 1234.5)
  assert.equal(parseWhen('10/25/21 10:00:18'), '2021-10-25T10:00:18')
  assert.equal(parseBvbPrice('<tr> <td>Ultimul pret</td><td align="right" style="font-weight:bold;">35,9800</td> </tr>'), 35.98)
})

import { xirr, monthsToTarget, safeMonthly } from './fi.ts'

test('yearly return with money in and out (XIRR) and the road to a target', () => {
  // 1.000 in, a year later worth 1.100 → 10%/year
  assert.ok(Math.abs(xirr([{ d: '2025-01-01', amt: 100000 }], 110000, '2026-01-01')! - 0.1) < 0.002)
  // 1.000 in, 500 out after 6 months, 600 left after a year → ~13%
  const r = xirr([{ d: '2025-01-01', amt: 100000 }, { d: '2025-07-02', amt: -50000 }], 60000, '2026-01-01')!
  assert.ok(r > 0.12 && r < 0.15)
  assert.equal(monthsToTarget(633000, 100000, 7, 30000000), 170) // 6.330 € + 1.000 €/month at 7% → ~14 years
  assert.equal(safeMonthly(30000000), 100000) // 300.000 € → 1.000 €/month at 4%
})

import { score, backtest, parseBvbIndicators, indicators, type StockData } from './radar.ts'

function fakeStock(symbol: string, f: (k: number) => number, days = 900): StockData {
  const t: number[] = [], c: number[] = []
  for (let k = 0; k < days; k++) { t.push(19000 + k); c.push(Math.round(f(k) * 100) / 100) }
  return { symbol, t, c, a: [...c], v: c.map(() => 10000), divs: [] }
}

test('radar: uptrend with a calm pullback scores higher than a falling stock', () => {
  const up = fakeStock('UP', k => 10 + k * 0.02 + Math.sin(k / 5) * 0.3)
  const down = fakeStock('DN', k => 40 - k * 0.03 + Math.sin(k / 5) * 0.3)
  const su = score({ ...up, divy: 7, per: 8, pbv: 1.1 }), sd = score({ ...down, divy: 1, per: 30, pbv: 4 })
  assert.ok(su.total > sd.total + 25, `${su.total} vs ${sd.total}`)
  assert.ok(su.ind.ma200! < su.ind.price)
  assert.equal(sd.label, 'avoid')
  assert.ok(su.reasons.some(r => r.text.startsWith('Dividend 7,0%')))
  const ind = indicators(up)
  assert.ok(ind.rsi! > 0 && ind.rsi! < 100 && ind.vol! > 0)
})

test('radar backtest invests monthly without looking ahead', () => {
  const a = fakeStock('A', k => 10 + k * 0.02), b = fakeStock('B', k => 30 - k * 0.01)
  const r = backtest([a, b], 19300, 19899, 1000, 1)
  assert.ok(r.months >= 18 && r.months <= 21)
  assert.equal(r.invested, r.months * 1000)
  assert.ok(r.radar.value > r.equal.value) // picks the rising one
})

test('BVB indicators table', () => {
  const html = '<title> BVB - Actiuni TLV BANCA TRANSILVANIA S.A. </title><tr> <td style="white-space:nowrap;">Capitalizare</td><td align="right" style="font-weight:bold;">44.888.167.667,00</td> </tr><tr> <td>PER</td><td align="right" style="font-weight:bold;">8,65</td> </tr><tr> <td>P/BV</td><td align="right">1,92</td> </tr><tr> <td>DIVY</td><td align="right">3,12</td> </tr>'
  const x = parseBvbIndicators(html)
  assert.equal(x.per, 8.65); assert.equal(x.pbv, 1.92); assert.equal(x.divy, 3.12); assert.equal(x.mcap, 44888167667); assert.equal(x.name, 'BANCA TRANSILVANIA S.A.')
})

import { readFileSync as rf } from 'node:fs'
test('server radar score matches the app score', async () => {
  const srv = await import('../../supabase/functions/market-radar/radar.ts')
  const k = (n: number) => 10 + n * 0.02 + Math.sin(n / 5) * 0.3
  const st = fakeStock('X', k)
  for (const extra of [{ per: 8, pbv: 1.1, divy: 7 }, { per: null, pbv: null, divy: 1 }, { per: 25, pbv: 3, divy: null }]) {
    const s = { ...st, ...extra }
    assert.equal(srv.score(s).total, score(s).total)
  }
  void rf
})

import { riskCalc, dueReviews, ideaReturn } from './journal.ts'
test('journal: risk in money and review dates', () => {
  const r = riskCalc({ portfolio: 30000, amount: 3000, price: 30, stop: 27, target: 39 })
  assert.equal(r.shares, 100); assert.equal(r.loss, 300); assert.equal(r.gain, 900); assert.equal(r.rr, 3)
  assert.ok(Math.abs(r.lossPct! - 300 / 33000 * 100) < 1e-9)
  assert.equal(r.maxShares2, 220)
  const e: any = { created_on: '2026-01-10', horizon_months: 12, reviews: { '3': {} }, action: 'cumpar', price_at: 10 }
  assert.deepEqual(dueReviews(e, '2026-07-15'), [6])
  assert.ok(Math.abs(ideaReturn({ action: 'vand', price_at: 10 }, 9) - 10) < 1e-9)
})

test('monthly plan: core ETF + capped satellites, whole shares', async () => {
  const { buildPlan, splitBySymbol } = await import('./plan.ts')
  const { score } = await import('./radar.ts')
  const mk = (symbol: string, price: number, up: number) => {
    const t: number[] = [], c: number[] = [], v: number[] = []
    for (let i = 0; i < 300; i++) { t.push(20000 + i); c.push(+(price * (1 + up * i / 300) * (1 + 0.01 * Math.sin(i / 3))).toFixed(3)); v.push(100000) }
    return { symbol, name: symbol, per: 8, pbv: 1, eps: null, divy: 7, t, a: c, c, v, divs: [] } as any
  }
  const stocks = [mk('TVBETETF', 20, 0.1), mk('AAA', 10, 0.15), mk('BBB', 5, 0.12), mk('HEAVY', 50, 0.15)].map(s => ({ s, sc: score(s) }))
  const p = buildPlan({ stocks, holdings: [{ symbol: 'HEAVY', value: 30000 }], cash: 5000, rules: {}, corePct: 50 })
  const core = p.items.find(i => i.role === 'nucleu')!
  assert.equal(core.symbol, 'TVBETETF')
  assert.ok(core.lei <= 2500 && core.shares === Math.floor(2500 / core.price))
  assert.ok(!p.items.some(i => i.symbol === 'HEAVY'), 'already above 25% is skipped')
  assert.ok(p.skipped.some(s => s.symbol === 'HEAVY'))
  for (const i of p.items) assert.equal(Number.isInteger(i.shares), true)
  assert.ok(Math.abs(p.invested + p.leftover - 5000) < 0.01)
  const parts = splitBySymbol('Intro\n### AAA — Firma\nbun\n### BBB\nrisc', ['AAA', 'BBB'])
  assert.equal(parts.AAA, 'bun'); assert.equal(parts.BBB, 'risc'); assert.equal(parts._intro, 'Intro')
})

test('weekly candles: open of Monday, close of Friday, extreme high/low', async () => {
  const { weeklyCandles } = await import('./radar.ts')
  const mon = 20034
  const m = mon - ((mon + 3) % 7)
  const s = { symbol: 'X', t: [m, m + 1, m + 4, m + 7], o: [10, 11, 12, 13], h: [12, 15, 13, 14], l: [9, 10, 8, 12], c: [11, 12, 12.5, 13.5], a: [11, 12, 12.5, 13.5], v: [1, 2, 3, 4] } as any
  const w = weeklyCandles(s, 0)
  assert.equal(w.length, 2)
  assert.deepEqual(w[0], { day: m, o: 10, h: 15, l: 8, c: 12.5, v: 6 })
  assert.equal(w[1].o, 13)
})
