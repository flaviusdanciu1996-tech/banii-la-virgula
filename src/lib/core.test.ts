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
