import type { Currency } from './money.ts'

export type Group = 'critic' | 'important' | 'optional' | 'economii'
export type Kind = 'in' | 'out'

export interface Category {
  id: string
  household_id: string
  name: string
  kind: Kind
  grp: Group | null // null for income categories
  icon: string
  allocated: number // minor units per period, 0 = no limit
  archived: boolean
  sort: number
}

export interface Tx {
  id: string
  household_id: string
  member_id: string
  kind: Kind
  amount: number // minor units RON, always positive
  category_id: string
  note: string
  date: string // YYYY-MM-DD
  created_at: string
  asset_id: string | null
  orig_amount?: number | null
  orig_currency?: string | null
  recurring_id?: string | null
  import_ref?: string | null
  orig_note?: string | null
  receipt_id?: string | null
  receipt_total?: number | null
  receipt_currency?: string | null
}

export interface Settings {
  household_id: string
  payday: number
  total_budget: number | null // explicit override, minor units
  savings_target_pct: number
  eur_rate: number // RON per 1 EUR
  usd_rate: number // RON per 1 USD
  rates_date: string | null
}

export type AssetSection = 'liquid' | 'invest' | 'goods' | 'debt'

export interface Asset {
  id: string
  household_id: string
  owner_id: string
  name: string
  kind: string
  platform: string
  currency: Currency
  value: number // minor units in `currency` (for debts: amount still owed, positive)
  invested: number // minor units in `currency`, investments only
  note: string
  updated_on: string
  archived: boolean
}

export interface Snapshot {
  household_id: string
  day: string
  liquid: number
  invest: number
  goods: number
  debts: number
  net: number
}

export interface Member {
  household_id: string
  user_id: string
  display_name: string
  role: 'owner' | 'member'
}

export interface Invite {
  id: string
  household_id: string
  code: string
  email: string
  accepted_at: string | null
  created_at: string
}

export const GROUPS: { id: Group; name: string; color: string }[] = [
  { id: 'critic', name: 'Critice', color: 'var(--g-critic)' },
  { id: 'important', name: 'Importante', color: 'var(--g-important)' },
  { id: 'optional', name: 'Opționale', color: 'var(--g-optional)' },
  { id: 'economii', name: 'Economii', color: 'var(--g-save)' },
]

export const groupOf = (id: Group | null) => GROUPS.find(g => g.id === id)

export const ASSET_KINDS: { id: string; name: string; section: AssetSection; icon: string }[] = [
  { id: 'cont_bancar', name: 'Cont bancar', section: 'liquid', icon: 'landmark' },
  { id: 'numerar', name: 'Numerar', section: 'liquid', icon: 'banknote' },
  { id: 'depozit', name: 'Cont economii / depozit', section: 'liquid', icon: 'piggy-bank' },
  { id: 'actiuni', name: 'Acțiuni / ETF', section: 'invest', icon: 'line-chart' },
  { id: 'crypto', name: 'Crypto', section: 'invest', icon: 'bitcoin' },
  { id: 'obligatiuni', name: 'Obligațiuni / titluri de stat', section: 'invest', icon: 'scroll' },
  { id: 'fonduri', name: 'Fonduri de investiții', section: 'invest', icon: 'pie-chart' },
  { id: 'alte_inv', name: 'Alte investiții', section: 'invest', icon: 'trending-up' },
  { id: 'masina', name: 'Mașină / vehicul', section: 'goods', icon: 'car' },
  { id: 'casa', name: 'Casă / apartament', section: 'goods', icon: 'home' },
  { id: 'teren', name: 'Teren', section: 'goods', icon: 'trees' },
  { id: 'alte_bunuri', name: 'Alte bunuri', section: 'goods', icon: 'package' },
  { id: 'credit', name: 'Credit', section: 'debt', icon: 'landmark' },
  { id: 'leasing', name: 'Leasing', section: 'debt', icon: 'file-text' },
  { id: 'card_credit', name: 'Card de credit', section: 'debt', icon: 'credit-card' },
  { id: 'datorii', name: 'Datorii personale', section: 'debt', icon: 'hand-coins' },
]

export const SECTIONS: { id: AssetSection; name: string; color: string }[] = [
  { id: 'liquid', name: 'Lichidități', color: 'var(--s-liquid)' },
  { id: 'invest', name: 'Investiții', color: 'var(--s-invest)' },
  { id: 'goods', name: 'Bunuri', color: 'var(--s-goods)' },
  { id: 'debt', name: 'Datorii', color: 'var(--s-debt)' },
]

export const kindOf = (id: string) => ASSET_KINDS.find(k => k.id === id) ?? ASSET_KINDS[ASSET_KINDS.length - 1]
export const PLATFORMS = ['Revolut', 'Tradeville', 'Binance', 'Bancă', 'Numerar']

export interface Recurring {
  id: string
  household_id: string
  member_id: string
  kind: Kind
  name: string
  amount: number // minor units in `currency`
  currency: Currency
  category_id: string
  day: number
  auto: boolean
  start_date: string
  last_run: string | null
  active: boolean
}

export interface Goal {
  id: string
  household_id: string
  name: string
  icon: string
  target: number
  saved: number
  deadline: string | null
  archived: boolean
}
