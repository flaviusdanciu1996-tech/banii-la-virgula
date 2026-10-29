import { useMemo, useState } from 'react'
import { FileUp, Check } from 'lucide-react'
import { useStore } from '../store.tsx'
import { CatIcon, EmptyArt } from '../ui.tsx'
import { catColor } from '../helpers.tsx'
import { fmt, fmtNum } from '../lib/money.ts'
import { shortDayLabel } from '../lib/period.ts'
import { parseBT, categorize, isOwnTransfer, detailHint, merchantKey, type ParsedTx, type PdfItem, type Rule } from '../lib/btImport.ts'
import { GROUPS } from '../lib/types.ts'
import { pendingReceipts, receiptForImport, type PendingReceipt } from '../lib/receipt.ts'

interface Row { tx: ParsedTx; include: boolean; cat: string; suggested: string; dup: boolean; receipt: PendingReceipt | null; own: boolean; ownSuggested: boolean }
const OWN = '__own__'

async function readPdf(file: File): Promise<PdfItem[]> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const items: PdfItem[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent()
    for (const it of tc.items as any[]) if (it.str) items.push({ page: p, x: it.transform[4], y: it.transform[5], str: it.str })
  }
  return items
}

export function ImportScreen({ notify }: { notify: (m: string) => void }) {
  const st = useStore()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [fileName, setFileName] = useState('')

  async function onFile(f: File | undefined) {
    if (!f) return
    setErr(''); setBusy(true); setRows(null); setFileName(f.name)
    try {
      if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') throw new Error('Alege extrasul în format PDF, descărcat din BT Pay sau BT24.')
      const items = await readPdf(f)
      const txs = parseBT(items)
      if (!txs.length) throw new Error('N-am găsit tranzacții în fișier. E un extras de cont BT (Banca Transilvania)?')
      const rules = await st.repo.list<Rule>('import_rules', st.householdId).catch(() => [] as Rule[])
      const known = new Set(st.txs.map(t => t.import_ref).filter(Boolean))
      const pending = pendingReceipts(st.txs)
      setRows(txs.map(tx => {
        const c = categorize(tx, rules, st.categories) || ''
        const dup = known.has(tx.ref)
        const receipt = dup || tx.kind === 'in' ? null : receiptForImport(tx, pending)
        if (receipt) pending.splice(pending.indexOf(receipt), 1)
        const own = !dup && isOwnTransfer(tx, rules)
        return { tx, cat: own ? '' : c, suggested: c, include: !dup && !receipt && !own, dup, receipt, own, ownSuggested: own }
      }))
    } catch (e: any) { setErr(e?.message || 'Nu am putut citi fișierul.') }
    finally { setBusy(false) }
  }

  const chosen = rows?.filter(r => r.include) ?? []
  const dupCount = rows?.filter(r => r.dup).length ?? 0
  const missing = chosen.filter(r => !r.cat).length
  const totals = useMemo(() => chosen.reduce((a, r) => {
    const v = r.tx.ron ?? st.toRonNow(r.tx.amount, (['RON', 'EUR', 'USD'].includes(r.tx.currency) ? r.tx.currency : 'RON') as any)
    if (r.tx.kind === 'in') a.in += v; else a.out += v
    return a
  }, { in: 0, out: 0 }), [chosen, st])

  async function doImport() {
    if (!rows) return
    if (missing) return setErr(`Alege categoria pentru ${missing} ${missing === 1 ? 'tranzacție' : 'tranzacții'} (cele marcate cu galben) sau debifează-le.`)
    setErr(''); setBusy(true)
    let n = 0
    try {
      // Bank lines already covered by a photographed receipt: link them so they never import twice.
      for (const r of rows.filter(x => x.receipt && !x.include)) {
        const first = r.receipt!.txs[0]
        try { await st.saveTx({ id: first.id, import_ref: r.tx.ref, orig_note: r.tx.original || null }) } catch { /* retry next import */ }
      }
      // Remember "between my accounts" choices (and their undoing) for the next statements.
      for (const r of rows) {
        const key = merchantKey(r.tx.merchant)
        if (!key || r.dup || r.own === r.ownSuggested) continue
        try {
          if (r.own) await st.repo.upsert('import_rules', { household_id: st.householdId, pattern: key, category_id: null, skip: true }, 'household_id,pattern')
          else if (!r.cat) await st.repo.upsert('import_rules', { household_id: st.householdId, pattern: key, category_id: null, skip: false }, 'household_id,pattern')
        } catch { /* non-critical */ }
      }
      for (const r of chosen) {
        const cur = r.tx.currency
        const known = cur === 'RON' || cur === 'EUR' || cur === 'USD'
        const ron = r.tx.ron ?? (known ? st.toRonNow(r.tx.amount, cur as any) : r.tx.amount)
        try {
          await st.saveTx({
            kind: r.tx.kind, amount: ron, category_id: r.cat, date: r.tx.date, note: r.tx.merchant.slice(0, 80), asset_id: null,
            orig_amount: cur !== 'RON' && known ? r.tx.amount : null, orig_currency: cur !== 'RON' && known ? (cur as any) : null,
            import_ref: r.tx.ref, orig_note: r.tx.original || null,
          })
          n++
        } catch (e: any) { if (!/duplicate|unique/i.test(e?.message || '')) throw e }
        // Remember the choice for this merchant when it differs from (or there was no) suggestion.
        const key = merchantKey(r.tx.merchant)
        if (key && (r.cat !== r.suggested || r.ownSuggested)) {
          try { await st.repo.upsert('import_rules', { household_id: st.householdId, pattern: key, category_id: r.cat, skip: false }, 'household_id,pattern') } catch { /* non-critical */ }
        }
      }
      notify(`${n} tranzacții importate`)
      setRows(null); setFileName('')
    } catch (e: any) { setErr(e?.message || 'Importul s-a oprit. Încearcă din nou: ce s-a importat deja nu se dublează.') }
    finally { setBusy(false) }
  }

  const set = (i: number, patch: Partial<Row>) => setRows(rs => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <div className="screen">
      <section className="card form">
        <h2>Import extras BT</h2>
        <p className="note">Descarcă extrasul de cont în PDF din BT Pay sau BT24 și alege-l aici. Aplicația pune singură fiecare plată pe categorie; tu doar verifici și apeși „Importă”.</p>
        <label className="upload">
          <FileUp size={20} />
          <span>{busy && !rows ? 'Citesc extrasul…' : fileName || 'Alege extrasul (PDF)'}</span>
          <input id="bt-file" type="file" accept="application/pdf,.pdf" onChange={e => onFile(e.target.files?.[0])} disabled={busy} />
        </label>
        <p className="hint">Fișierul e citit doar pe telefonul tău. În aplicație se salvează numai tranzacțiile pe care le imporți. Ce ai importat o dată nu se mai dublează.</p>
      </section>

      {err && <p className="err">{err}</p>}

      {rows && (rows.length === 0 ? <EmptyArt icon="inbox" title="Nimic de importat" text="Fișierul nu conține plăți sau încasări." /> : <>
        <div className="card import-sum">
          <div><span>Selectate</span><b className="num">{chosen.length} din {rows.length - dupCount}</b></div>
          <div><span>Cheltuieli</span><b className="num">{fmtNum(totals.out)}</b></div>
          <div><span>Încasări</span><b className="num in">{fmtNum(totals.in)}</b></div>
        </div>
        {dupCount > 0 && <p className="hint">{dupCount === rows.length ? 'Toate tranzacțiile din acest extras sunt deja în aplicație. Nu ai nimic de făcut.' : `${dupCount} ${dupCount === 1 ? 'tranzacție e' : 'tranzacții sunt'} deja în aplicație și nu mai apar aici. Vezi doar ce lipsește.`}</p>}
        <div className="rows">
          {rows.map((r, i) => {
            if (r.dup) return null
            const c = st.categories.find(x => x.id === r.cat)
            const cats = st.categories.filter(x => x.kind === r.tx.kind && !x.archived)
            return (
              <div key={r.tx.ref + i} className={'row import-row' + (r.include ? '' : ' off') + (r.include && !r.cat ? ' need' : '')}>
                <label className="imp-check" aria-label="Include">
                  <input type="checkbox" checked={r.include} onChange={e => set(i, { include: e.target.checked, ...(e.target.checked ? { own: false } : {}) })} />
                  <span>{r.include && <Check size={14} />}</span>
                </label>
                <span className="row-main">
                  <b>{r.tx.merchant || r.tx.title}</b>
                  {detailHint(r.tx) && <span className="muted small imp-hint">🔎 {detailHint(r.tx)}</span>}
                  <span className="muted small">{shortDayLabel(r.tx.date)}{r.tx.original ? ` · ${r.tx.original}` : ''}{r.dup ? ' · deja importată' : ''}{r.own ? ' · ↔ între conturile tale, nu se numără' : ''}{r.receipt ? ' · acoperită de bon 🧾' : ''}</span>
                  <span className="imp-cat">
                    <CatIcon icon={c?.icon || 'circle'} color={catColor(c)} size={26} />
                    <select aria-label="Categoria" value={r.own ? OWN : r.cat} onChange={e => e.target.value === OWN ? set(i, { own: true, cat: '', include: false }) : set(i, { cat: e.target.value, include: true, own: false })}>
                      <option value="">Alege categoria…</option>
                      <option value={OWN}>↔ Între conturile mele (nu se numără)</option>
                      {r.tx.kind === 'in' ? cats.map(x => <option key={x.id} value={x.id}>{x.name}</option>)
                        : GROUPS.map(g => <optgroup key={g.id} label={g.name}>{cats.filter(x => x.grp === g.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>)}
                    </select>
                  </span>
                </span>
                <span className="row-side">
                  <b className={'num' + (r.tx.kind === 'in' ? ' in' : '')}>{r.tx.kind === 'in' ? '+' : '−'}{fmtNum(r.tx.amount)} {r.tx.currency === 'RON' ? 'lei' : r.tx.currency === 'EUR' ? '€' : r.tx.currency}</b>
                  {r.tx.currency !== 'RON' && r.tx.ron !== null && <span className="orig num">≈ {fmt(r.tx.ron)}</span>}
                </span>
              </div>
            )
          })}
        </div>
        <p className="hint">Când schimbi categoria unui comerciant, aplicația ține minte alegerea pentru extrasele viitoare. Banii mutați între conturile tale („↔ Între conturile mele”) nu sunt nici cheltuială, nici venit: nu se importă, iar aplicația ține minte și asta.</p>
        <button type="button" className="primary" disabled={busy || !chosen.length} onClick={doImport}>{busy ? 'Import…' : `Importă ${chosen.length} ${chosen.length === 1 ? 'tranzacție' : 'tranzacții'}`}</button>
      </>)}
    </div>
  )
}
