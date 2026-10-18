import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react'
import { supabase, type Repo } from './db.ts'
import type { Category, Tx, Settings, Asset, Snapshot, Member, Invite, Recurring, Goal } from './lib/types.ts'
import { duePostings } from './lib/schedule.ts'
import type { Currency } from './lib/money.ts'
import { netWorth } from './lib/calc.ts'
import { todayIso } from './lib/period.ts'

export interface User { id: string; email: string; name: string }

interface State {
  ready: boolean
  error: string | null
  householdId: string
  user: User
  categories: Category[]
  txs: Tx[]
  assets: Asset[]
  snapshots: Snapshot[]
  settings: Settings
  members: Member[]
  invites: Invite[]
  recurring: Recurring[]
  goals: Goal[]
}

const DEFAULT_SETTINGS: Settings = { household_id: '', payday: 1, total_budget: null, savings_target_pct: 20, eur_rate: 4.97, usd_rate: 4.3, rates_date: null }

export interface Store extends State {
  repo: Repo
  rates: { EUR: number; USD: number }
  reload(): Promise<void>
  saveTx(t: Partial<Tx>): Promise<void>
  deleteTx(id: string): Promise<void>
  saveCategory(c: Partial<Category>): Promise<void>
  saveSettings(p: Partial<Settings>): Promise<void>
  saveAsset(a: Partial<Asset>): Promise<void>
  deleteAsset(id: string): Promise<void>
  createInvite(email: string): Promise<Invite>
  deleteInvite(id: string): Promise<void>
  removeMember(userId: string): Promise<void>
  renameMe(name: string): Promise<void>
  refreshRates(force?: boolean): Promise<void>
  saveRecurring(r: Partial<Recurring>): Promise<void>
  deleteRecurring(id: string): Promise<void>
  saveGoal(g: Partial<Goal>): Promise<void>
  deleteGoal(id: string): Promise<void>
  toRonNow(minor: number, cur: Currency): number
}

const Ctx = createContext<Store | null>(null)
export const useStore = () => useContext(Ctx)!

const num = (v: unknown) => (typeof v === 'string' ? Number(v) : (v as number))

export function StoreProvider({ repo, user, children }: { repo: Repo; user: User; children: ReactNode }) {
  const [s, setS] = useState<State>({
    ready: false, error: null, householdId: '', user, categories: [], txs: [], assets: [], snapshots: [],
    settings: DEFAULT_SETTINGS, members: [], invites: [], recurring: [], goals: [],
  })

  const reload = useCallback(async () => {
    try {
      const h = await repo.rpc<string>('ensure_household', { p_name: user.name })
      const [categories, txs, assets, snapshots, settingsRows, members, invites, recurring, goals] = await Promise.all([
        repo.list<Category>('categories', h), repo.list<Tx>('transactions', h), repo.list<Asset>('assets', h),
        repo.list<Snapshot>('snapshots', h), repo.list<Settings>('settings', h), repo.list<Member>('members', h),
        repo.list<Invite>('invites', h), repo.list<Recurring>('recurring', h).catch(() => []), repo.list<Goal>('goals', h).catch(() => []),
      ])
      const st = settingsRows[0] ? { ...settingsRows[0], eur_rate: num(settingsRows[0].eur_rate), usd_rate: num(settingsRows[0].usd_rate) } : { ...DEFAULT_SETTINGS, household_id: h }
      setS(p => ({
        ...p, ready: true, error: null, householdId: h, settings: st,
        categories: categories.map(c => ({ ...c, allocated: num(c.allocated) })).sort((a, b) => a.sort - b.sort),
        txs: txs.map(t => ({ ...t, amount: num(t.amount), orig_amount: t.orig_amount == null ? null : num(t.orig_amount) })),
        recurring: recurring.map(r => ({ ...r, amount: num(r.amount) })),
        goals: goals.map(g => ({ ...g, target: num(g.target), saved: num(g.saved) })),
        assets: assets.map(a => ({ ...a, value: num(a.value), invested: num(a.invested) })),
        snapshots: snapshots.map(x => ({ ...x, liquid: num(x.liquid), invest: num(x.invest), goods: num(x.goods), debts: num(x.debts), net: num(x.net) })),
        members, invites,
      }))
      setRecurringRan(false)
    } catch (e: any) {
      setS(p => ({ ...p, ready: true, error: e?.message || 'Nu s-au putut încărca datele.' }))
    }
  }, [repo, user.name])

  useEffect(() => { reload() }, [reload])

  const [recurringRan, setRecurringRan] = useState(false)
  const rates = useMemo(() => ({ EUR: s.settings.eur_rate || 4.97, USD: s.settings.usd_rate || 4.3 }), [s.settings])

  // Keep one net-worth snapshot per day, written only when today's totals change.
  const snapshotToday = useCallback(async (assets: Asset[], st: State) => {
    const nw = netWorth(assets, { EUR: st.settings.eur_rate, USD: st.settings.usd_rate })
    const day = todayIso()
    const prev = st.snapshots.find(x => x.day === day)
    if (prev && prev.net === nw.net && prev.liquid === nw.liquid && prev.invest === nw.invest && prev.goods === nw.goods && prev.debts === nw.debts) return
    const row: Snapshot = { household_id: st.householdId, day, liquid: nw.liquid, invest: nw.invest, goods: nw.goods, debts: nw.debts, net: nw.net }
    try {
      await repo.upsert('snapshots', row, 'household_id,day')
      setS(p => ({ ...p, snapshots: [...p.snapshots.filter(x => x.day !== day), row] }))
    } catch { /* non-critical */ }
  }, [repo])

  useEffect(() => {
    if (s.ready && !s.error && s.householdId) snapshotToday(s.assets, s)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.ready, s.assets, s.settings.eur_rate, s.settings.usd_rate])

  const store: Store = {
    ...s, repo, rates, reload,
    async saveTx(t) {
      const row = { ...t, household_id: s.householdId }
      const saved = t.id
        ? await repo.update<Tx>('transactions', { id: t.id }, row)
        : await repo.insert<Tx>('transactions', { member_id: user.id, ...row })
      saved.amount = num(saved.amount)
      setS(p => ({ ...p, txs: [...p.txs.filter(x => x.id !== saved.id), saved] }))
    },
    async deleteTx(id) {
      const t = s.txs.find(x => x.id === id)
      await repo.remove('transactions', { id })
      if (t?.receipt_path && supabase && !s.txs.some(x => x.id !== id && x.receipt_path === t.receipt_path)) {
        supabase.storage.from('receipts').remove([t.receipt_path]).catch(() => {})
      }
      setS(p => ({ ...p, txs: p.txs.filter(x => x.id !== id) }))
    },
    async saveCategory(c) {
      const row = { ...c, household_id: s.householdId }
      const saved = c.id ? await repo.update<Category>('categories', { id: c.id }, row) : await repo.insert<Category>('categories', row)
      saved.allocated = num(saved.allocated)
      setS(p => ({ ...p, categories: [...p.categories.filter(x => x.id !== saved.id), saved].sort((a, b) => a.sort - b.sort) }))
    },
    async saveSettings(patch) {
      const saved = await repo.upsert<Settings>('settings', { ...s.settings, ...patch, household_id: s.householdId }, 'household_id')
      setS(p => ({ ...p, settings: { ...saved, eur_rate: num(saved.eur_rate), usd_rate: num(saved.usd_rate) } }))
    },
    async saveAsset(a) {
      const row = { ...a, household_id: s.householdId }
      const saved = a.id ? await repo.update<Asset>('assets', { id: a.id }, row) : await repo.insert<Asset>('assets', { owner_id: user.id, ...row })
      saved.value = num(saved.value); saved.invested = num(saved.invested)
      setS(p => ({ ...p, assets: [...p.assets.filter(x => x.id !== saved.id), saved] }))
    },
    async deleteAsset(id) {
      await repo.remove('assets', { id })
      setS(p => ({ ...p, assets: p.assets.filter(x => x.id !== id) }))
    },
    async createInvite(email) {
      const inv = await repo.insert<Invite>('invites', { household_id: s.householdId, email, created_by: user.id } as any)
      setS(p => ({ ...p, invites: [...p.invites, inv] }))
      return inv
    },
    async deleteInvite(id) {
      await repo.remove('invites', { id })
      setS(p => ({ ...p, invites: p.invites.filter(x => x.id !== id) }))
    },
    async removeMember(userId) {
      await repo.remove('members', { household_id: s.householdId, user_id: userId })
      setS(p => ({ ...p, members: p.members.filter(x => x.user_id !== userId) }))
    },
    async renameMe(name) {
      const saved = await repo.update<Member>('members', { household_id: s.householdId, user_id: user.id }, { display_name: name })
      setS(p => ({ ...p, members: p.members.map(m => (m.user_id === user.id ? saved : m)) }))
    },
    toRonNow(minor, cur) {
      if (cur === 'RON') return minor
      return Math.round(minor * (cur === 'EUR' ? rates.EUR : rates.USD))
    },
    async saveRecurring(r) {
      const row = { ...r, household_id: s.householdId }
      const saved = r.id ? await repo.update<Recurring>('recurring', { id: r.id }, row) : await repo.insert<Recurring>('recurring', { member_id: user.id, ...row })
      saved.amount = num(saved.amount)
      setS(p => ({ ...p, recurring: [...p.recurring.filter(x => x.id !== saved.id), saved] }))
      setRecurringRan(false)
    },
    async deleteRecurring(id) {
      await repo.remove('recurring', { id })
      setS(p => ({ ...p, recurring: p.recurring.filter(x => x.id !== id) }))
    },
    async saveGoal(g) {
      const row = { ...g, household_id: s.householdId }
      const saved = g.id ? await repo.update<Goal>('goals', { id: g.id }, row) : await repo.insert<Goal>('goals', row)
      saved.target = num(saved.target); saved.saved = num(saved.saved)
      setS(p => ({ ...p, goals: [...p.goals.filter(x => x.id !== saved.id), saved] }))
    },
    async deleteGoal(id) {
      await repo.remove('goals', { id })
      setS(p => ({ ...p, goals: p.goals.filter(x => x.id !== id) }))
    },
    async refreshRates(force = false) {
      const today = todayIso()
      if (!force && s.settings.rates_date === today) return
      const urls = ['https://api.frankfurter.dev/v1/latest?base=EUR&symbols=RON,USD', 'https://api.frankfurter.app/latest?from=EUR&to=RON,USD']
      for (const u of urls) {
        try {
          const r = await fetch(u)
          if (!r.ok) continue
          const j = await r.json()
          const ron = Number(j?.rates?.RON), usd = Number(j?.rates?.USD)
          if (!ron || !usd) continue
          await store.saveSettings({ eur_rate: Math.round(ron * 10000) / 10000, usd_rate: Math.round((ron / usd) * 10000) / 10000, rates_date: today })
          return
        } catch { /* try next */ }
      }
      if (force) throw new Error('Nu am putut lua cursul acum. Poți să-l scrii manual.')
    },
  }

  useEffect(() => {
    if (s.ready && !s.error && s.householdId) store.refreshRates().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.ready, s.householdId])

  // Post automatic recurring entries that fell due since the last run (idempotent: one per item per date).
  useEffect(() => {
    if (!s.ready || s.error || !s.householdId || recurringRan) return
    setRecurringRan(true)
    ;(async () => {
      const today = todayIso()
      for (const r of s.recurring) {
        if (!r.active || !r.auto) continue
        const dates = duePostings(r.day, r.start_date, r.last_run, today)
        if (!dates.length) continue
        for (const date of dates) {
          if (s.txs.some(t => t.recurring_id === r.id && t.date === date)) continue
          const ron = store.toRonNow(r.amount, r.currency)
          try {
            const t = await repo.insert<Tx>('transactions', {
              household_id: s.householdId, member_id: r.member_id, kind: r.kind, amount: ron, category_id: r.category_id,
              note: r.name, date, recurring_id: r.id, asset_id: null,
              ...(r.currency !== 'RON' ? { orig_amount: r.amount, orig_currency: r.currency } : {}),
            } as Partial<Tx>)
            t.amount = num(t.amount)
            setS(p => ({ ...p, txs: [...p.txs.filter(x => x.id !== t.id), t] }))
          } catch { /* already posted by another device */ }
        }
        try {
          const u = await repo.update<Recurring>('recurring', { id: r.id }, { last_run: today })
          setS(p => ({ ...p, recurring: p.recurring.map(x => (x.id === r.id ? { ...x, last_run: u.last_run } : x)) }))
        } catch { /* retry next open */ }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.ready, s.householdId, recurringRan])

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}
