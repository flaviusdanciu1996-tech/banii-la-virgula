import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Filled at build time (public values, safe to ship: access is enforced by row level security).
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY as string | undefined

export const DEMO = typeof location !== 'undefined' && /[?&]demo\b/.test(location.search)

export const supabase: SupabaseClient | null = SUPABASE_URL && SUPABASE_KEY && !DEMO
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null

export type Table = 'categories' | 'transactions' | 'assets' | 'snapshots' | 'settings' | 'members' | 'invites' | 'households' | 'recurring' | 'goals' | 'push_subs' | 'import_rules' | 'asset_values'

/** Thin repository so the UI works the same against Supabase or the in-memory demo. */
export interface Repo {
  list<T>(table: Table, householdId: string): Promise<T[]>
  insert<T>(table: Table, row: Partial<T>): Promise<T>
  update<T>(table: Table, match: Record<string, unknown>, patch: Partial<T>): Promise<T>
  upsert<T>(table: Table, row: Partial<T>, onConflict: string): Promise<T>
  remove(table: Table, match: Record<string, unknown>): Promise<void>
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>
}

function err(e: { message: string } | null) {
  if (e) throw new Error(e.message)
}

export function supabaseRepo(sb: SupabaseClient): Repo {
  return {
    async list(table, h) {
      const key = table === 'households' ? 'id' : 'household_id'
      const all: any[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from(table).select('*').eq(key, h).range(from, from + 999)
        err(error)
        all.push(...(data || []))
        if (!data || data.length < 1000) break
      }
      return all
    },
    async insert(table, row) {
      const { data, error } = await sb.from(table).insert(row as any).select().single()
      err(error); return data as any
    },
    async update(table, match, patch) {
      let q: any = sb.from(table).update(patch as any)
      for (const [k, v] of Object.entries(match)) q = q.eq(k, v)
      const { data, error } = await q.select().single()
      err(error); return data
    },
    async upsert(table, row, onConflict) {
      const { data, error } = await sb.from(table).upsert(row as any, { onConflict }).select().single()
      err(error); return data as any
    },
    async remove(table, match) {
      let q: any = sb.from(table).delete()
      for (const [k, v] of Object.entries(match)) q = q.eq(k, v)
      const { error } = await q
      err(error)
    },
    async rpc(fn, args) {
      const { data, error } = await sb.rpc(fn, args)
      err(error); return data as any
    },
  }
}

/* ---------------- In-memory demo (opened with ?demo) ---------------- */

const uid = () => (crypto as any).randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)

export function demoRepo(seed: Record<Table, any[]>): Repo {
  const db = seed
  const keyOf = (t: Table) => (t === 'settings' ? 'household_id' : 'id')
  const match = (row: any, m: Record<string, unknown>) => Object.entries(m).every(([k, v]) => row[k] === v)
  return {
    async list(table, h) { return db[table].filter(r => (table === 'households' ? r.id : r.household_id) === h).map(r => ({ ...r })) },
    async insert(table, row) {
      const r: any = { id: uid(), created_at: new Date().toISOString(), ...row }
      db[table].push(r); return { ...r }
    },
    async update(table, m, patch) {
      const r = db[table].find(x => match(x, m)); if (!r) throw new Error('not found')
      Object.assign(r, patch); return { ...r }
    },
    async upsert(table, row: any, onConflict) {
      const keys = onConflict.split(',')
      const r = db[table].find(x => keys.every(k => x[k] === row[k]))
      if (r) { Object.assign(r, row); return { ...r } }
      const n = { ...row }; db[table].push(n); return { ...n }
    },
    async remove(table, m) { db[table] = db[table].filter(x => !match(x, m)) },
    async rpc(fn) {
      if (fn === 'ensure_household') return 'demo-h' as any
      throw new Error('În modul demo nu se poate.')
    },
  }
  void keyOf
}
