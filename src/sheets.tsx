import { useState } from 'react'
import { useStore } from './store.tsx'
import { Sheet, Seg, MoneyField, ConfirmButton } from './ui.tsx'
import { Icon } from './icons.tsx'
import { parseMoney, fmt, fmtNum, CUR_LABEL, type Currency } from './lib/money.ts'
import { Repeat } from 'lucide-react'
import { ReceiptPhoto } from './screens/Receipt.tsx'
import { todayIso } from './lib/period.ts'
import { GROUPS, ASSET_KINDS, SECTIONS, PLATFORMS, kindOf, type Tx, type Kind, type Category, type Group, type Asset, type AssetSection } from './lib/types.ts'
import { ICON_CHOICES } from './icons.tsx'

/* ---------------- Transaction ---------------- */

export function TxSheet({ tx, kind: initialKind = 'out', template, onClose, notify, onSaved }: {
  tx?: Tx; kind?: Kind; template?: Partial<Tx>; onClose: () => void; notify: (m: string) => void; onSaved?: () => void
}) {
  const st = useStore()
  const src = tx ?? template
  const [kind, setKind] = useState<Kind>(src?.kind ?? initialKind)
  const [currency, setCurrency] = useState<Currency>((src?.orig_currency as Currency) || 'RON')
  const [amount, setAmount] = useState(src ? fmtNum(src.orig_currency && src.orig_currency !== 'RON' && src.orig_amount ? src.orig_amount : (src.amount || 0)) : '')
  const [cat, setCat] = useState<string | null>(src?.category_id ?? null)
  const [date, setDate] = useState(tx?.date ?? todayIso())
  const [note, setNote] = useState(src?.note ?? '')
  const [member, setMember] = useState(tx?.member_id ?? st.user.id)
  const [assetId, setAssetId] = useState<string>(tx?.asset_id ?? '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const cats = st.categories.filter(c => c.kind === kind && (!c.archived || c.id === cat))
  const chosen = st.categories.find(c => c.id === cat)
  const linkable = kind === 'out' && chosen?.grp === 'economii'
  const assetOpts = st.assets.filter(a => !a.archived && kindOf(a.kind).section !== 'debt' && kindOf(a.kind).section !== 'goods')

  // Most recently used categories of this kind, for one-tap picking.
  const recent: Category[] = []
  for (const t of [...st.txs].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (t.kind !== kind) continue
    const c = st.categories.find(x => x.id === t.category_id)
    if (c && !c.archived && !recent.includes(c)) recent.push(c)
    if (recent.length >= 5) break
  }

  const parsed = parseMoney(amount)
  const ron = parsed && parsed > 0 ? st.toRonNow(parsed, currency) : null

  async function save(asNew = false) {
    const v = parseMoney(amount)
    if (v === null || v <= 0) return setErr('Scrie o sumă mai mare ca zero, cu virgulă și cel mult două zecimale (ex. 23,50).')
    if (!cat) return setErr('Alege o categorie.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setErr('Alege data.')
    setBusy(true); setErr('')
    try {
      const unchanged = tx && !asNew && (tx.orig_currency || 'RON') === currency && (currency === 'RON' ? tx.amount : tx.orig_amount) === v
      const amountRon = unchanged ? tx!.amount : st.toRonNow(v, currency)
      const link = linkable && assetId ? assetId : null
      const editing = tx && !asNew
      await st.saveTx({
        id: editing ? tx!.id : undefined, kind, amount: amountRon, category_id: cat, date: asNew ? todayIso() : date, note: note.trim(),
        member_id: editing ? member : st.user.id, asset_id: link,
        orig_amount: currency === 'RON' ? null : v, orig_currency: currency === 'RON' ? null : currency,
      })
      if (link && !editing) {
        const a = st.assets.find(x => x.id === link)
        if (a) {
          const inCur = a.currency === 'RON' ? amountRon : Math.round(amountRon / (a.currency === 'EUR' ? st.rates.EUR : st.rates.USD))
          await st.saveAsset({ id: a.id, value: a.value + inCur, invested: (a.invested || 0) + inCur, updated_on: todayIso() })
        }
      }
      notify(asNew ? 'Repetat azi' : tx ? 'Modificat' : kind === 'in' ? 'Venit adăugat' : 'Cheltuială adăugată')
      onSaved?.()
      onClose()
    } catch (e: any) { setErr(e?.message || 'Nu s-a putut salva. Încearcă din nou.') }
    finally { setBusy(false) }
  }

  return (
    <Sheet title={tx ? 'Modifică' : kind === 'in' ? 'Venit nou' : 'Cheltuială nouă'} onClose={onClose}>
      <Seg label="Tip" value={kind} onChange={k => { setKind(k); setCat(null) }} options={[{ id: 'out', label: 'Cheltuială' }, { id: 'in', label: 'Venit' }]} />
      <MoneyField id="tx-amount" big value={amount} onChange={setAmount} suffix={CUR_LABEL[currency]} autoFocus={!tx} />
      <div className="cur-row">
        <div className="cur-seg" role="group" aria-label="Moneda">
          {(['RON', 'EUR', 'USD'] as Currency[]).map(c => (
            <button key={c} type="button" aria-pressed={c === currency} onClick={() => setCurrency(c)}>{c === 'RON' ? 'lei' : CUR_LABEL[c]}</button>
          ))}
        </div>
        <span className="hint">{currency !== 'RON' && ron ? `≈ ${fmt(ron)} la cursul de azi` : 'Scrie cu virgulă, de ex. 23,50'}</span>
      </div>
      <div className="chip-groups">
        {recent.length > 0 && <ChipGroup label="Folosite recent" color="var(--accent-2)" cats={recent} cat={cat} setCat={setCat} />}
        {kind === 'in' ? (
          <ChipGroup label="Venit" color="var(--in)" cats={cats} cat={cat} setCat={setCat} />
        ) : GROUPS.map(g => (
          <ChipGroup key={g.id} label={g.name} color={g.color} cats={cats.filter(c => c.grp === g.id)} cat={cat} setCat={setCat} />
        ))}
      </div>
      {linkable && assetOpts.length > 0 && (
        <label className="field">Adaugă banii și în Avere (opțional)
          <select id="tx-asset" value={assetId} onChange={e => setAssetId(e.target.value)}>
            <option value="">Nu</option>
            {assetOpts.map(a => <option key={a.id} value={a.id}>{a.name}{a.platform ? ' · ' + a.platform : ''}</option>)}
          </select>
        </label>
      )}
      <div className="two">
        <label className="field">Data<input id="tx-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label className="field">Notă<input id="tx-note" maxLength={80} placeholder="opțional" value={note} onChange={e => setNote(e.target.value)} /></label>
      </div>
      {tx && st.members.length > 1 && (
        <label className="field">Cine
          <select id="tx-member" value={member} onChange={e => setMember(e.target.value)}>
            {st.members.map(m => <option key={m.user_id} value={m.user_id}>{m.display_name}{m.user_id === st.user.id ? ' (eu)' : ''}</option>)}
          </select>
        </label>
      )}
      {tx?.receipt_path && <ReceiptPhoto path={tx.receipt_path} />}
      {err && <p className="err">{err}</p>}
      <div className="actions">
        {tx && <ConfirmButton onConfirm={async () => { await st.deleteTx(tx.id); notify('Șters'); onClose() }} />}
        {tx && <button type="button" className="ghost-btn" disabled={busy} onClick={() => save(true)}><Repeat size={16} />Repetă azi</button>}
        <button type="button" className="primary" disabled={busy} onClick={() => save()}>{busy ? 'Se salvează…' : 'Salvează'}</button>
      </div>
    </Sheet>
  )
}

function ChipGroup({ label, color, cats, cat, setCat }: { label: string; color: string; cats: Category[]; cat: string | null; setCat: (c: string) => void }) {
  if (!cats.length) return null
  return (
    <div className="chip-group">
      <span className="chip-label"><i className="dot" style={{ background: color }} />{label}</span>
      <div className="chips">
        {cats.map(c => (
          <button key={c.id} type="button" className="chip" aria-pressed={c.id === cat} onClick={() => setCat(c.id)}>
            <Icon name={c.icon} size={15} color={c.kind === 'in' ? 'var(--in)' : (GROUPS.find(g => g.id === c.grp)?.color)} />{c.name}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ---------------- Category ---------------- */

export function CategorySheet({ cat, kind = 'out', onClose, notify }: { cat?: Category; kind?: Kind; onClose: () => void; notify: (m: string) => void }) {
  const st = useStore()
  const k = cat?.kind ?? kind
  const [name, setName] = useState(cat?.name ?? '')
  const [grp, setGrp] = useState<Group>((cat?.grp as Group) ?? 'optional')
  const [icon, setIcon] = useState(cat?.icon ?? 'circle')
  const [alloc, setAlloc] = useState(cat ? fmtNum(cat.allocated) : '')
  const [err, setErr] = useState('')

  async function save(archived = cat?.archived ?? false) {
    if (!name.trim()) return setErr('Scrie un nume.')
    const a = alloc.trim() ? parseMoney(alloc) : 0
    if (a === null || a < 0) return setErr('Limita nu e validă (ex. 1.200,00).')
    try {
      await st.saveCategory({ id: cat?.id, name: name.trim(), kind: k, grp: k === 'in' ? null : grp, icon, allocated: k === 'in' ? 0 : a, archived, sort: cat?.sort ?? 100 + st.categories.length })
      notify(archived ? 'Categorie arhivată' : 'Salvat'); onClose()
    } catch (e: any) { setErr(e?.message || 'Nu s-a putut salva.') }
  }

  return (
    <Sheet title={cat ? 'Categorie' : 'Categorie nouă'} onClose={onClose}>
      <label className="field">Nume<input id="cat-name" value={name} maxLength={40} onChange={e => setName(e.target.value)} /></label>
      {k === 'out' && <>
        <Seg label="Grupă" value={grp} onChange={setGrp} options={GROUPS.map(g => ({ id: g.id, label: g.name }))} />
        <label className="field">Limită pe lună (0 = fără limită)</label>
        <MoneyField id="cat-alloc" value={alloc} onChange={setAlloc} suffix="lei" />
      </>}
      <div className="field">Iconiță</div>
      <div className="icon-grid">
        {ICON_CHOICES.map(n => (
          <button key={n} type="button" className="icon-choice" aria-pressed={n === icon} aria-label={n} onClick={() => setIcon(n)}><Icon name={n} size={18} /></button>
        ))}
      </div>
      {err && <p className="err">{err}</p>}
      <div className="actions">
        {cat && !cat.archived && <ConfirmButton armedText="Arhivez?" onConfirm={() => save(true)}>Arhivează</ConfirmButton>}
        {cat?.archived && <button type="button" className="ghost-btn" onClick={() => save(false)}>Reactivează</button>}
        <button type="button" className="primary" onClick={() => save()}>Salvează</button>
      </div>
    </Sheet>
  )
}

/* ---------------- Asset (Avere) ---------------- */

export function AssetSheet({ asset, section = 'liquid', quick, onClose, notify }: { asset?: Asset; section?: AssetSection; quick?: boolean; onClose: () => void; notify: (m: string) => void }) {
  const st = useStore()
  const [kind, setKind] = useState(asset?.kind ?? ASSET_KINDS.find(k => k.section === section)!.id)
  const sec = kindOf(kind).section
  const [name, setName] = useState(asset?.name ?? '')
  const [platform, setPlatform] = useState(asset?.platform ?? '')
  const [currency, setCurrency] = useState<Currency>(asset?.currency ?? 'RON')
  const [value, setValue] = useState(asset ? fmtNum(asset.value) : '')
  const [invested, setInvested] = useState(asset?.invested ? fmtNum(asset.invested) : '')
  const [note, setNote] = useState(asset?.note ?? '')
  const [err, setErr] = useState('')

  async function save() {
    const v = parseMoney(value)
    if (v === null || v < 0) return setErr(sec === 'debt' ? 'Scrie cât mai ai de dat (ex. 15.000,00).' : 'Scrie valoarea actuală (ex. 15.000,00).')
    const inv = sec === 'invest' ? (invested.trim() ? parseMoney(invested) : 0) : 0
    if (inv === null || inv < 0) return setErr('Suma investită nu e validă.')
    if (!quick && !name.trim()) return setErr('Scrie un nume, de ex. „Revolut” sau „Dacia Logan”.')
    try {
      await st.saveAsset(quick && asset
        ? { id: asset.id, value: v, updated_on: todayIso() }
        : { id: asset?.id, name: name.trim(), kind, platform: platform.trim(), currency, value: v, invested: inv, note: note.trim(), updated_on: todayIso(), archived: false })
      notify('Valoare actualizată'); onClose()
    } catch (e: any) { setErr(e?.message || 'Nu s-a putut salva.') }
  }

  if (quick && asset) {
    return (
      <Sheet title={`Actualizează: ${asset.name}`} onClose={onClose}>
        <p className="hint">{kindOf(asset.kind).section === 'debt' ? 'Cât mai ai de dat azi?' : 'Cât valorează azi?'}</p>
        <MoneyField id="asset-quick" big value={value} onChange={setValue} suffix={CUR_LABEL[asset.currency]} autoFocus />
        {err && <p className="err">{err}</p>}
        <div className="actions"><button type="button" className="primary" onClick={save}>Actualizează</button></div>
      </Sheet>
    )
  }

  return (
    <Sheet title={asset ? 'Modifică' : 'Adaugă în Avere'} onClose={onClose}>
      <label className="field">Tip
        <select id="asset-kind" value={kind} onChange={e => setKind(e.target.value)}>
          {SECTIONS.map(s => (
            <optgroup key={s.id} label={s.name}>
              {ASSET_KINDS.filter(k => k.section === s.id).map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="field">Nume<input id="asset-name" maxLength={50} placeholder={sec === 'goods' ? 'ex. Dacia Logan 2019' : sec === 'debt' ? 'ex. Leasing mașină' : 'ex. Revolut'} value={name} onChange={e => setName(e.target.value)} /></label>
      {(sec === 'liquid' || sec === 'invest') && <>
        <label className="field">Unde (aplicație / bancă)<input id="asset-platform" maxLength={40} value={platform} onChange={e => setPlatform(e.target.value)} /></label>
        <div className="chips">{PLATFORMS.map(p => <button key={p} type="button" className="chip" aria-pressed={p === platform} onClick={() => setPlatform(p)}>{p}</button>)}</div>
      </>}
      <Seg label="Moneda" value={currency} onChange={setCurrency} options={[{ id: 'RON', label: 'Lei' }, { id: 'EUR', label: 'Euro' }, { id: 'USD', label: 'Dolari' }]} />
      <label className="field">{sec === 'debt' ? 'Cât mai ai de dat' : 'Valoare actuală'}</label>
      <MoneyField id="asset-value" big value={value} onChange={setValue} suffix={CUR_LABEL[currency]} />
      {sec === 'goods' && <p className="hint">Pune cât ai lua pe el dacă l-ai vinde azi (caută anunțuri cu ceva asemănător). Actualizează-l o dată la câteva luni.</p>}
      {sec === 'invest' && <>
        <label className="field">Cât ai băgat în total (opțional)</label>
        <MoneyField id="asset-invested" value={invested} onChange={setInvested} suffix={CUR_LABEL[currency]} />
        <p className="hint">Din diferența dintre valoare și cât ai băgat se calculează profitul.</p>
      </>}
      <label className="field">Notă<input id="asset-note" maxLength={80} placeholder="opțional" value={note} onChange={e => setNote(e.target.value)} /></label>
      {err && <p className="err">{err}</p>}
      <div className="actions">
        {asset && <ConfirmButton onConfirm={async () => { await st.deleteAsset(asset.id); notify('Șters'); onClose() }} />}
        <button type="button" className="primary" onClick={save}>Salvează</button>
      </div>
    </Sheet>
  )
}
