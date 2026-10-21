// Official BNR exchange rates (table fx_rates, filled daily from curs.bnr.ro), loaded once per session.
import { supabase } from './db.ts'
import { fxTableFrom, type FxTable } from './lib/crypto.ts'

let cache: Promise<FxTable | null> | null = null
export function loadBnr(): Promise<FxTable | null> {
  if (!supabase) return Promise.resolve(null)
  cache ??= (async () => {
    const rows: any[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase!.from('fx_rates').select('day,cur,rate').in('cur', ['EUR', 'USD']).order('day').range(from, from + 999)
      if (error) return null
      rows.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }
    return rows.length ? fxTableFrom(rows) : null
  })()
  return cache
}
