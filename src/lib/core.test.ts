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
