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
  ['Telefon & internet', 'out', 'critic', 'smartphone', 15000], ['WC & dușuri', 'out', 'critic', 'droplets', 5000], ['Haine', 'out', 'important', 'shirt', 30000],
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
    { id: 'a2', household_id: H, owner_id: U, name: 'Tradeville', kind: 'actiuni', platform: 'Tradeville', broker: 'Tradeville', currency: 'RON', value: 1031600, invested: 1100000, note: '', updated_on: today, archived: false, prices_on: today,
      holdings: [{ symbol: 'TVBETETF', qty: 220, cost: 520000, price: 26.1 }, { symbol: 'TLV', qty: 120, cost: 380000, price: 35.98 }, { symbol: 'SNP', qty: 250, cost: 200000, price: 0.95 }],
      invest_summary: { deposits: 1500000, withdrawals: 400000, dividends: 61200, commissions: 9800, realized: 85400, cash: 1890, first: '2022-01-10', last: addDays(today, -12), count: 84,
        flows: [{ d: '2022-01-10', amt: 600000 }, { d: '2022-09-01', amt: 400000 }, { d: '2023-06-01', amt: 300000 }, { d: '2024-03-01', amt: 200000 }, { d: '2025-07-01', amt: -400000 }] } },
    { id: 'a3', household_id: H, owner_id: U, name: 'Revolut Crypto', kind: 'crypto', platform: 'Revolut', currency: 'RON', value: 270340, invested: 311800, note: '', updated_on: today, archived: false, prices_on: today,
      coins: [
        { coin: 'BTC', pair: 'BTC/EUR', price: 392450, ch24: 0.94, at: new Date().toISOString(), spark: Array.from({ length: 31 }, (_, k) => 360000 + k * 1100 + Math.sin(k / 2) * 9000) },
        { coin: 'DOT', pair: 'DOT/EUR', price: 5.5, ch24: -0.07, at: new Date().toISOString(), spark: Array.from({ length: 31 }, (_, k) => 4.6 + k * 0.03 + Math.sin(k / 3) * 0.2) },
      ] },
    { id: 'a4', household_id: H, owner_id: U, name: 'Dacia Logan', kind: 'masina', platform: '', currency: 'EUR', value: 850000, invested: 0, note: '', updated_on: addDays(today, -60), archived: false },
    { id: 'a7', household_id: H, owner_id: U, name: 'Samsung S25 Ultra', kind: 'electronice', platform: '', currency: 'RON', value: 333000, invested: 0, note: '', updated_on: addDays(today, -3), archived: false,
      purchase_price: 400000, purchase_date: addDays(today, -95), dep_rate: 35, market_query: 'Samsung Galaxy S25 Ultra 512GB', market_on: true, market_discount: 10, market_checked_on: addDays(today, -3), value_source: 'market',
      market_offers: [
        { title: 'Samsung S25 Ultra 512GB Titanium Black, garanție', price: 3900, currency: 'RON', source: 'OLX', url: 'https://www.olx.ro/', used: true },
        { title: 'Galaxy S25 Ultra 512 GB impecabil, cutie completă', price: 3650, currency: 'RON', source: 'OLX', url: 'https://www.olx.ro/', used: true },
        { title: 'S25 Ultra 512GB Silverblue', price: 740, currency: 'EUR', source: 'Publi24', url: 'https://www.publi24.ro/', used: true },
        { title: 'Samsung Galaxy S25 Ultra 512GB resigilat', price: 4100, currency: 'RON', source: 'eMAG', url: 'https://www.emag.ro/', used: true },
        { title: 'S25 Ultra 512 ca nou', price: 3600, currency: 'RON', source: 'Lajumate', url: 'https://lajumate.ro/', used: true },
        { title: 'S25 Ultra 512GB display spart', price: 1500, currency: 'RON', source: 'OLX', url: 'https://www.olx.ro/', used: false },
      ] },
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
    settings: [{ household_id: H, payday: 1, total_budget: null, savings_target_pct: 20, eur_rate: 4.9768, usd_rate: 4.2851, rates_date: today, fi_target: 30000000, fi_currency: 'EUR', fi_monthly: 100000, fi_return: 7, fi_include_liquid: true }],
    categories, transactions, assets, snapshots, invites: [], push_subs: [], import_rules: [], invest_tx: [], invest_journal: [], fiscal_income: [],
    crypto_tx: [
      { id: 'c1', household_id: H, asset_id: 'a3', coin: 'BTC', kind: 'buy', qty: 0.004, price: 300000, currency: 'RON', fee: 6, fx: null, at: addDays(today, -400) + 'T10:00:00Z', note: '' },
      { id: 'c2', household_id: H, asset_id: 'a3', coin: 'BTC', kind: 'buy', qty: 0.002, price: 350000, currency: 'RON', fee: 6, fx: null, at: addDays(today, -120) + 'T10:00:00Z', note: '' },
      { id: 'c3', household_id: H, asset_id: 'a3', coin: 'DOT', kind: 'buy', qty: 60, price: 20, currency: 'RON', fee: 6, fx: null, at: addDays(today, -300) + 'T10:00:00Z', note: '' },
      { id: 'c4', household_id: H, asset_id: 'a3', coin: 'DOT', kind: 'reward', qty: 3.4, price: null, currency: 'RON', fee: 0, fx: null, at: addDays(today, -20) + 'T10:00:00Z', note: 'Recompense staking' },
    ],
    asset_values: [
      { id: 'v1', household_id: H, asset_id: 'a7', day: addDays(today, -95), value: 400000, source: 'purchase' },
      { id: 'v2', household_id: H, asset_id: 'a7', day: addDays(today, -64), value: 380000, source: 'depreciation' },
      { id: 'v3', household_id: H, asset_id: 'a7', day: addDays(today, -33), value: 355000, source: 'market' },
      { id: 'v4', household_id: H, asset_id: 'a7', day: addDays(today, -3), value: 333000, source: 'market' },
    ],
    recurring: [
      { id: 'r1', household_id: H, member_id: U, kind: 'out', name: 'Chirie', amount: 150000, currency: 'RON', category_id: id('Chirie / rată'), day: 16, auto: true, start_date: addDays(today, -90), last_run: today, active: true },
      { id: 'r2', household_id: H, member_id: U, kind: 'out', name: 'Netflix + Spotify', amount: 6999, currency: 'RON', category_id: id('Abonamente'), day: 4, auto: true, start_date: addDays(today, -90), last_run: today, active: true },
      { id: 'r3', household_id: H, member_id: U, kind: 'out', name: 'Rată leasing', amount: 32000, currency: 'EUR', category_id: id('Chirie / rată'), day: 25, auto: false, start_date: addDays(today, -90), last_run: today, active: true },
      { id: 'r4', household_id: H, member_id: U, kind: 'out', name: 'Asigurare RCA', amount: 18000, currency: 'RON', category_id: id('Asigurări'), day: 22, auto: false, start_date: addDays(today, -90), last_run: today, active: true },
    ],
    goals: [
      { id: 'g1', household_id: H, name: 'Cabana A-frame', category: 'casa', icon: 'trees', target: 18000000, saved: 4150000, deadline: addDays(today, 900), archived: false, note: 'Liniște la munte, cu vedere spre Cheile Ordâncușii', photo_path: "data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20viewBox%3D%270%200%20400%20300%27%3E%3Cdefs%3E%3ClinearGradient%20id%3D%27s%27%20x1%3D%270%27%20y1%3D%270%27%20x2%3D%270%27%20y2%3D%271%27%3E%3Cstop%20offset%3D%270%27%20stop-color%3D%27%232b2d6e%27/%3E%3Cstop%20offset%3D%27.6%27%20stop-color%3D%27%23e8875b%27/%3E%3Cstop%20offset%3D%271%27%20stop-color%3D%27%23f6c27a%27/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect%20width%3D%27400%27%20height%3D%27300%27%20fill%3D%27url%28%23s%29%27/%3E%3Ccircle%20cx%3D%27300%27%20cy%3D%27170%27%20r%3D%2734%27%20fill%3D%27%23ffd79a%27/%3E%3Cpath%20d%3D%27M0%20220%20L90%20130%20L170%20210%20L250%20120%20L400%20230%20L400%20300%20L0%20300Z%27%20fill%3D%27%233a3f63%27/%3E%3Cpath%20d%3D%27M0%20260%20L120%20200%20L260%20250%20L400%20215%20L400%20300%20L0%20300Z%27%20fill%3D%27%231f3b2f%27/%3E%3Cpath%20d%3D%27M150%20262%20L200%20160%20L250%20262Z%27%20fill%3D%27%232a1a12%27/%3E%3Cpath%20d%3D%27M178%20262%20L200%20214%20L222%20262Z%27%20fill%3D%27%23f7c46c%27/%3E%3Crect%20x%3D%2760%27%20y%3D%27240%27%20width%3D%276%27%20height%3D%2730%27%20fill%3D%27%23132a20%27/%3E%3Cpath%20d%3D%27M50%20245%20L63%20205%20L76%20245Z%27%20fill%3D%27%23163527%27/%3E%3Cpath%20d%3D%27M320%20250%20L335%20200%20L350%20250Z%27%20fill%3D%27%23163527%27/%3E%3C/svg%3E" },
      { id: 'g3', household_id: H, name: 'Mașina nouă', category: 'masini', icon: 'car', target: 9000000, saved: 1800000, deadline: addDays(today, 540), archived: false, photo_path: "data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20viewBox%3D%270%200%20400%20300%27%3E%3Cdefs%3E%3ClinearGradient%20id%3D%27s%27%20x1%3D%270%27%20y1%3D%270%27%20x2%3D%271%27%20y2%3D%271%27%3E%3Cstop%20offset%3D%270%27%20stop-color%3D%27%230f2a4a%27/%3E%3Cstop%20offset%3D%271%27%20stop-color%3D%27%233a7bd5%27/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect%20width%3D%27400%27%20height%3D%27300%27%20fill%3D%27url%28%23s%29%27/%3E%3Crect%20y%3D%27215%27%20width%3D%27400%27%20height%3D%2785%27%20fill%3D%27%2316233a%27/%3E%3Cpath%20d%3D%27M70%20205%20Q90%20160%20150%20150%20L250%20150%20Q300%20152%20330%20190%20L345%20205%20Q350%20222%20335%20225%20L80%20225%20Q62%20222%2070%20205Z%27%20fill%3D%27%23e9eef6%27/%3E%3Cpath%20d%3D%27M150%20158%20L245%20158%20Q280%20162%20300%20188%20L130%20188%20Q135%20165%20150%20158Z%27%20fill%3D%27%232a3f5f%27/%3E%3Ccircle%20cx%3D%27125%27%20cy%3D%27225%27%20r%3D%2722%27%20fill%3D%27%230b1220%27/%3E%3Ccircle%20cx%3D%27125%27%20cy%3D%27225%27%20r%3D%279%27%20fill%3D%27%239aa7b8%27/%3E%3Ccircle%20cx%3D%27292%27%20cy%3D%27225%27%20r%3D%2722%27%20fill%3D%27%230b1220%27/%3E%3Ccircle%20cx%3D%27292%27%20cy%3D%27225%27%20r%3D%279%27%20fill%3D%27%239aa7b8%27/%3E%3C/svg%3E" },
      { id: 'g4', household_id: H, name: 'Vacanță la mare', category: 'calatorii', icon: 'plane', target: 0, saved: 0, deadline: null, archived: false, note: 'Grecia, vara viitoare', photo_path: "data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20viewBox%3D%270%200%20400%20300%27%3E%3Cdefs%3E%3ClinearGradient%20id%3D%27s%27%20x1%3D%270%27%20y1%3D%270%27%20x2%3D%270%27%20y2%3D%271%27%3E%3Cstop%20offset%3D%270%27%20stop-color%3D%27%2357c1eb%27/%3E%3Cstop%20offset%3D%271%27%20stop-color%3D%27%23b6ecff%27/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect%20width%3D%27400%27%20height%3D%27300%27%20fill%3D%27url%28%23s%29%27/%3E%3Ccircle%20cx%3D%2780%27%20cy%3D%2770%27%20r%3D%2730%27%20fill%3D%27%23fff3b0%27/%3E%3Cpath%20d%3D%27M0%20190%20Q100%20170%20200%20190%20T400%20185%20L400%20300%20L0%20300Z%27%20fill%3D%27%231e88b8%27/%3E%3Cpath%20d%3D%27M0%20240%20Q120%20225%20240%20245%20T400%20240%20L400%20300%20L0%20300Z%27%20fill%3D%27%23f2d8a7%27/%3E%3Cpath%20d%3D%27M260%2060%20L330%2080%20L345%2072%20L352%2078%20L338%2088%20L360%20120%20L350%20122%20L322%2094%20L300%20100%20L298%20112%20L290%20112%20L288%2098%20L262%2070Z%27%20fill%3D%27%23fff%27/%3E%3C/svg%3E" },
      { id: 'g2', household_id: H, name: 'Fond de urgență', category: 'bani', icon: 'life-buoy', target: 1500000, saved: 1120000, deadline: null, archived: false },
      { id: 'g5', household_id: H, name: 'Islanda', category: 'calatorii', icon: 'plane', target: 0, saved: 0, deadline: null, archived: false },
      { id: 'g6', household_id: H, name: 'Seminar Tony Robbins', category: 'oameni', icon: 'users', target: 0, saved: 0, deadline: null, archived: false },
      { id: 'g7', household_id: H, name: 'Permis moto', category: 'experiente', icon: 'sparkles', target: 0, saved: 0, deadline: null, archived: false, done_on: addDays(today, -40) },
      { id: 'g8', household_id: H, name: 'Concediu cu familia', category: 'familie', icon: 'heart', target: 0, saved: 0, deadline: null, archived: false },
      { id: 'g9', household_id: H, name: 'Dubai', category: 'calatorii', icon: 'plane', target: 0, saved: 0, deadline: null, archived: false, done_on: addDays(today, -200) },
    ],
  }
}

export const DEMO_USER = { id: U, email: 'demo@exemplu.ro', name: 'Flavius Danciu' }
