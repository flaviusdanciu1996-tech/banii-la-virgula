// Sample data for the ?demo preview only. Never written to the real database.
import type { Table } from './db.ts'
import { addDays, todayIso } from './lib/period.ts'

const H = 'demo-h'
const U = 'demo-u'
const U2 = 'demo-u2'

const CATS: [string, 'in' | 'out', string | null, string, number][] = [
  ['Chirie / rată', 'out', 'critic', 'home', 150000], ['Utilități', 'out', 'critic', 'plug', 60000],
  ['Mâncare acasă', 'out', 'critic', 'shopping-cart', 180000], ['Transport', 'out', 'critic', 'bus', 20000],
  ['Combustibil', 'out', 'critic', 'fuel', 80000], ['Sănătate', 'out', 'critic', 'heart-pulse', 20000],
  ['Telefon & internet', 'out', 'critic', 'smartphone', 15000], ['Haine', 'out', 'important', 'shirt', 30000],
  ['Casă', 'out', 'important', 'sofa', 30000], ['Educație', 'out', 'important', 'graduation-cap', 0],
  ['Familie & cadouri', 'out', 'important', 'gift', 20000], ['Asigurări', 'out', 'important', 'shield', 25000],
  ['Restaurante & cafenele', 'out', 'optional', 'utensils', 40000], ['Băuturi alcoolice', 'out', 'optional', 'wine', 10000],
  ['Îngrijire personală & sport', 'out', 'optional', 'dumbbell', 15000], ['Distracție', 'out', 'optional', 'party-popper', 20000],
  ['Abonamente', 'out', 'optional', 'repeat', 8000], ['Cumpărături diverse', 'out', 'optional', 'shopping-bag', 0],
  ['Economii', 'out', 'economii', 'piggy-bank', 200000], ['Investiții', 'out', 'economii', 'trending-up', 100000],
  ['Fond de urgență', 'out', 'economii', 'life-buoy', 0], ['Salariu', 'in', null, 'wallet', 0], ['Diurnă', 'in', null, 'truck', 0],
  ['Bonus', 'in', null, 'sparkles', 0], ['Alte venituri', 'in', null, 'circle-plus', 0],
]

export function demoSeed(): Record<Table, any[]> {
  const today = todayIso()
  const categories = CATS.map(([name, kind, grp, icon, allocated], i) => ({ id: 'c' + i, household_id: H, name, kind, grp, icon, allocated, archived: false, sort: i }))
  const id = (n: string) => categories.find(c => c.name === n)!.id
  const transactions: any[] = []
  let k = 0
  const add = (daysAgo: number, cat: string, amount: number, note = '', member = U) => {
    const date = addDays(today, -daysAgo)
    transactions.push({ id: 't' + k++, household_id: H, member_id: member, kind: cat === 'Salariu' || cat === 'Diurnă' ? 'in' : 'out', amount, category_id: id(cat), note, date, created_at: date + 'T12:00:00', asset_id: null })
  }
  for (const m of [0, 30, 60]) {
    add(m + 17, 'Salariu', 450000, 'Salariu')
    add(m + 15, 'Diurnă', 600000, 'Diurnă cursa DE')
    add(m + 16, 'Chirie / rată', 150000)
    add(m + 14, 'Utilități', 52000 + m * 30, 'Curent + gaz')
    add(m + 13, 'Economii', 150000)
    add(m + 12, 'Investiții', 100000, 'ETF Tradeville')
    for (let d = 0; d < 17; d += 2) add(m + d, 'Mâncare acasă', 6000 + ((d * 1337 + m) % 9000), d % 4 ? 'Lidl' : 'Kaufland', d % 6 === 0 ? U2 : U)
    add(m + 3, 'Combustibil', 32000)
    add(m + 9, 'Restaurante & cafenele', 18500 + m * 100, 'Cină')
    add(m + 5, 'Restaurante & cafenele', 4250, 'Cafea')
    add(m + 7, 'Telefon & internet', 12000)
    add(m + 4, 'Abonamente', 6999, 'Netflix + Spotify')
    add(m + 6, 'Îngrijire personală & sport', 9000)
  }
  add(1, 'Distracție', 26000, 'Concert')
  transactions.push({ id: 'teur', household_id: H, member_id: U, kind: 'out', amount: 6221, category_id: id('Restaurante & cafenele'), note: 'Prânz în parcare, DE', date: addDays(today, -1), created_at: addDays(today, -1) + 'T13:00:00', asset_id: null, orig_amount: 1250, orig_currency: 'EUR' })
  add(2, 'Băuturi alcoolice', 7350)
  add(0, 'Mâncare acasă', 304, 'Pâine')
  const assets = [
    { id: 'a1', household_id: H, owner_id: U, name: 'Revolut', kind: 'cont_bancar', platform: 'Revolut', currency: 'EUR', value: 182040, invested: 0, note: '', updated_on: addDays(today, -2), archived: false },
    { id: 'a2', household_id: H, owner_id: U, name: 'Portofoliu ETF', kind: 'actiuni', platform: 'Tradeville', currency: 'RON', value: 1248000, invested: 1100000, note: '', updated_on: addDays(today, -5), archived: false },
    { id: 'a3', household_id: H, owner_id: U, name: 'Bitcoin', kind: 'crypto', platform: 'Binance', currency: 'USD', value: 241000, invested: 300000, note: '', updated_on: addDays(today, -40), archived: false },
    { id: 'a4', household_id: H, owner_id: U, name: 'Dacia Logan', kind: 'masina', platform: '', currency: 'EUR', value: 850000, invested: 0, note: '', updated_on: addDays(today, -60), archived: false },
    { id: 'a5', household_id: H, owner_id: U, name: 'Numerar acasă', kind: 'numerar', platform: 'Numerar', currency: 'RON', value: 150000, invested: 0, note: '', updated_on: today, archived: false },
    { id: 'a6', household_id: H, owner_id: U, name: 'Leasing mașină', kind: 'leasing', platform: '', currency: 'EUR', value: 320000, invested: 0, note: '', updated_on: addDays(today, -10), archived: false },
  ]
  const snapshots = Array.from({ length: 10 }, (_, i) => {
    const day = addDays(today, -30 * (9 - i))
    const net = 6100000 + i * 160000 + (i % 3) * 50000
    return { household_id: H, day, liquid: 1200000, invest: 1500000, goods: 4200000, debts: 1700000, net }
  })
  return {
    households: [{ id: H, name: 'Familia mea', owner_id: U }],
    members: [{ household_id: H, user_id: U, display_name: 'Flavius Danciu', role: 'owner' }, { household_id: H, user_id: U2, display_name: 'Ana Pop', role: 'member' }],
    settings: [{ household_id: H, payday: 1, total_budget: null, savings_target_pct: 20, eur_rate: 4.9768, usd_rate: 4.2851, rates_date: today }],
    categories, transactions, assets, snapshots, invites: [], push_subs: [], import_rules: [],
    recurring: [
      { id: 'r1', household_id: H, member_id: U, kind: 'out', name: 'Chirie', amount: 150000, currency: 'RON', category_id: id('Chirie / rată'), day: 16, auto: true, start_date: addDays(today, -90), last_run: today, active: true },
      { id: 'r2', household_id: H, member_id: U, kind: 'out', name: 'Netflix + Spotify', amount: 6999, currency: 'RON', category_id: id('Abonamente'), day: 4, auto: true, start_date: addDays(today, -90), last_run: today, active: true },
      { id: 'r3', household_id: H, member_id: U, kind: 'out', name: 'Rată leasing', amount: 32000, currency: 'EUR', category_id: id('Chirie / rată'), day: 25, auto: false, start_date: addDays(today, -90), last_run: today, active: true },
      { id: 'r4', household_id: H, member_id: U, kind: 'out', name: 'Asigurare RCA', amount: 18000, currency: 'RON', category_id: id('Asigurări'), day: 22, auto: false, start_date: addDays(today, -90), last_run: today, active: true },
    ],
    goals: [
      { id: 'g1', household_id: H, name: 'Cabana de la munte', icon: 'trees', target: 5000000, saved: 1250000, deadline: addDays(today, 730), archived: false },
      { id: 'g2', household_id: H, name: 'Fond de urgență', icon: 'life-buoy', target: 1500000, saved: 1120000, deadline: null, archived: false },
    ],
  }
}

export const DEMO_USER = { id: U, email: 'demo@exemplu.ro', name: 'Flavius Danciu' }
