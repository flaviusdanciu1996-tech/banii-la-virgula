import { useRef, useState } from 'react'
import { Camera, Link2, Plus } from 'lucide-react'
import { useStore } from '../store.tsx'
import { Sheet, CatIcon } from '../ui.tsx'
import { catColor } from '../helpers.tsx'
import { supabase, DEMO } from '../db.ts'
import { fmt, fmtNum, CUR_LABEL } from '../lib/money.ts'
import { todayIso, shortDayLabel } from '../lib/period.ts'
import { matchReceipt, groupItems, splitProportional, toMinor, type ReadReceipt, type ReceiptItem } from '../lib/receipt.ts'
import { GROUPS, type Tx } from '../lib/types.ts'

/** Shrink the photo (max 1600 px, JPEG) so it uploads fast on mobile data. */
async function compress(file: File): Promise<{ data: string; mime: string }> {
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    const url = c.toDataURL('image/jpeg', 0.82)
    return { data: url.split(',')[1], mime: 'image/jpeg' }
  } catch {
    const buf = new Uint8Array(await file.arrayBuffer())
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    return { data: btoa(bin), mime: file.type || 'image/jpeg' }
  }
}

const DEMO_RECEIPT: ReadReceipt = { merchant: 'Aral', date: todayIso(), total: 3, currency: 'EUR', items: [{ name: 'WC-Benutzung', name_ro: 'Folosire WC', amount: 1, category: 'WC & dușuri' }, { name: 'Kaffee', name_ro: 'Cafea', amount: 2, category: 'Restaurante & cafenele' }] }

/** Camera button: takes the photo, reads it, then opens the review sheet. */
export function ReceiptButton({ notify, className = 'add receipt' }: { notify: (m: string) => void; className?: string }) {
  const st = useStore()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ReadReceipt | null>(null)

  async function onPick(f?: File) {
    if (!f) return
    setBusy(true)
    try {
      let r: any
      if (DEMO || !supabase) r = DEMO_RECEIPT
      else {
        const img = await compress(f)
        const names = st.categories.filter(c => c.kind === 'out' && !c.archived).map(c => c.name)
        const { data, error } = await supabase.functions.invoke('read-receipt', { body: { image: img.data, mime: img.mime, categories: names } })
        if (error) {
          let code = ''
          try { code = (await (error as any).context?.json())?.error || '' } catch { /* ignore */ }
          throw new Error(code === 'missing_key' ? 'Citirea bonurilor nu e încă activată (lipsește cheia Gemini).'
            : code === 'rate_limited' ? 'Prea multe bonuri într-un minut. Mai încearcă puțin mai târziu.'
            : 'Nu am putut citi bonul. Încearcă o poză mai clară, cu tot bonul în cadru.')
        }
        r = data
      }
      if (!r?.is_receipt && !DEMO && r?.is_receipt !== undefined) throw new Error('Nu pare a fi un bon. Fă poza cu tot bonul, drept și cu lumină bună.')
      if (!r?.total || !r?.items?.length) throw new Error('Nu am găsit totalul pe bon. Încearcă o poză mai clară.')
      setResult({ merchant: r.merchant || 'Bon', date: /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? r.date : todayIso(), total: Number(r.total), currency: String(r.currency || 'RON').toUpperCase().slice(0, 3), items: r.items })
    } catch (e: any) { notify(e?.message || 'Nu am putut citi bonul.') }
    finally { setBusy(false); if (input.current) input.current.value = '' }
  }

  return (
    <>
      <label className={className} aria-busy={busy}>
        <Camera size={18} />{busy ? 'Citesc bonul…' : 'Bon'}
        <input ref={input} type="file" accept="image/*" capture="environment" disabled={busy} onChange={e => onPick(e.target.files?.[0])} />
      </label>
      {result && <ReceiptSheet r={result} notify={notify} onClose={() => setResult(null)} />}
    </>
  )
}

function ReceiptSheet({ r, onClose, notify }: { r: ReadReceipt; onClose: () => void; notify: (m: string) => void }) {
  const st = useStore()
  const outCats = st.categories.filter(c => c.kind === 'out' && !c.archived)
  const byName = (n: string) => outCats.find(c => c.name.toLowerCase() === (n || '').toLowerCase())
  const fallback = outCats.find(c => c.name === 'Cumpărături diverse') ?? outCats[0]
  const [items, setItems] = useState<(ReceiptItem & { catId: string })[]>(() => r.items.map(it => ({ ...it, catId: (byName(it.category) ?? fallback).id })))
  const [date, setDate] = useState(r.date)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const total = toMinor(r.total)
  const match = matchReceipt({ total, currency: r.currency, date }, st.txs)

  async function ronTotal(): Promise<number> {
    if (match) return match.amount
    if (r.currency === 'RON') return total
    if (r.currency === 'EUR' || r.currency === 'USD') return st.toRonNow(total, r.currency)
    for (const u of [`https://api.frankfurter.dev/v1/latest?base=${r.currency}&symbols=RON`, `https://api.frankfurter.app/latest?from=${r.currency}&to=RON`]) {
      try { const j = await (await fetch(u)).json(); const rate = Number(j?.rates?.RON); if (rate) return Math.round(total * rate) } catch { /* next */ }
    }
    throw new Error(`Nu am găsit cursul pentru ${r.currency}. Încearcă din nou când ai internet.`)
  }

  async function save() {
    setErr(''); setBusy(true)
    try {
      const groups = groupItems(items.map(i => ({ ...i, category: i.catId })))
      const ron = await ronTotal()
      const ronParts = splitProportional(ron, groups.map(g => g.amount))
      const origParts = splitProportional(total, groups.map(g => g.amount))
      const rid = (crypto as any).randomUUID ? crypto.randomUUID() : String(Date.now())
      const note = (i: number) => `${r.merchant} · ${groups[i].names.join(', ')}`.slice(0, 80)
      const common = { receipt_id: rid, receipt_total: total, receipt_currency: r.currency }
      if (match) {
        // Re-categorise (and if needed split) the bank entry that this receipt explains.
        const mOrig = match.orig_amount != null ? splitProportional(match.orig_amount, groups.map(g => g.amount)) : null
        await st.saveTx({ id: match.id, category_id: groups[0].category, amount: ronParts[0], note: note(0), ...(mOrig ? { orig_amount: mOrig[0] } : {}), ...common })
        for (let i = 1; i < groups.length; i++) {
          await st.saveTx({ kind: 'out', amount: ronParts[i], category_id: groups[i].category, date: match.date, note: note(i), asset_id: null,
            ...(mOrig ? { orig_amount: mOrig[i], orig_currency: match.orig_currency } : {}), ...common })
        }
        notify(groups.length > 1 ? `Plata din extras împărțită pe ${groups.length} categorii` : 'Categoria din extras a fost corectată')
      } else {
        for (let i = 0; i < groups.length; i++) {
          await st.saveTx({ kind: 'out', amount: ronParts[i], category_id: groups[i].category, date, note: note(i), asset_id: null,
            ...(r.currency !== 'RON' ? { orig_amount: origParts[i], orig_currency: r.currency } : {}), ...common })
        }
        notify('Bon salvat. La importul extrasului nu se va dubla.')
      }
      onClose()
    } catch (e: any) { setErr(e?.message || 'Nu s-a putut salva.') }
    finally { setBusy(false) }
  }

  return (
    <Sheet title={`Bon: ${r.merchant}`} onClose={onClose}>
      <div className="receipt-head">
        <div><span className="muted small">Total pe bon</span><b className="num" style={{ fontSize: 24 }}>{fmtNum(total)} {CUR_LABEL[r.currency]}</b></div>
        <label className="field" style={{ minWidth: 140 }}>Data<input id="rc-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      </div>

      <div className={'match ' + (match ? 'found' : 'new')}>
        {match ? <Link2 size={18} /> : <Plus size={18} />}
        <span>{match
          ? <>Am găsit plata în extras: <b>{match.note || 'plată'}</b>, {shortDayLabel(match.date)}, <b className="num">{fmt(match.amount)}</b>. O corectez după bon.</>
          : <>Plata nu e încă în extras. O adaug acum, iar când imporți extrasul BT nu se va dubla.</>}</span>
      </div>

      <div className="rows">
        {items.map((it, i) => {
          const c = st.categories.find(x => x.id === it.catId)
          return (
            <div key={i} className="row receipt-item">
              <CatIcon icon={c?.icon || 'circle'} color={catColor(c)} size={32} />
              <span className="row-main">
                <b>{it.name_ro || it.name}</b>
                {it.name_ro && it.name_ro !== it.name && <span className="muted small">{it.name}</span>}
                <select aria-label="Categoria" value={it.catId} onChange={e => setItems(xs => xs.map((x, j) => (j === i ? { ...x, catId: e.target.value } : x)))}>
                  {GROUPS.map(g => <optgroup key={g.id} label={g.name}>{outCats.filter(x => x.grp === g.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>)}
                </select>
              </span>
              <b className="num row-amt">{fmtNum(toMinor(it.amount))}</b>
            </div>
          )
        })}
      </div>
      {err && <p className="err">{err}</p>}
      <div className="actions"><button type="button" className="primary" disabled={busy} onClick={save}>{busy ? 'Salvez…' : 'Salvează bonul'}</button></div>
    </Sheet>
  )
}

export type { Tx }
