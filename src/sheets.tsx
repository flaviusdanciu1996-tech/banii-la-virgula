import { useState } from 'react'
import { useStore } from './store.tsx'
import { Sheet, Seg, MoneyField, ConfirmButton } from './ui.tsx'
import { Icon } from './icons.tsx'
import { parseMoney, fmt, fmtNum, CUR_LABEL, type Currency } from './lib/money.ts'
import { Repeat, Plus, Trash2, ChevronDown } from 'lucide-react'
import { ReceiptPhoto } from './screens/Receipt.tsx'
import { DepreciationFields, AssetValuePanel } from './screens/AssetValue.tsx'
import { InvestPanel } from './screens/BrokerImport.tsx'
import { DEFAULT_DEP, estimateOn } from './lib/valuation.ts'
import { todayIso } from './lib/period.ts'
import { GROUPS, ASSET_KINDS, SECTIONS, PLATFORMS, kindOf, type Tx, type Kind, type Category, type Group, type Asset, type AssetSection, type AssetPart } from './lib/types.ts'
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
  const [parts, setParts] = useState<PartDraft[]>(() => (asset?.parts ?? []).map(toDraft))
  const [err, setErr] = useState('')
  const [dep, setDepState] = useState({
    price: asset?.purchase_price ? fmtNum(asset.purchase_price) : '',
    date: asset?.purchase_date ?? '',
    rate: String(asset?.dep_rate ?? DEFAULT_DEP[kind] ?? ''),
    marketOn: asset?.market_on ?? kind === 'electronice',
    query: asset?.market_query ?? '',
    discount: String(asset?.market_discount ?? 10),
  })
  const [rateTouched, setRateTouched] = useState(!!asset?.dep_rate)
  const setDep = (p: Partial<typeof dep>) => { if (p.rate !== undefined) setRateTouched(true); setDepState(d => ({ ...d, ...p })) }
  function changeKind(k: string) {
    setKind(k)
    if (!rateTouched) setDepState(d => ({ ...d, rate: String(DEFAULT_DEP[k] ?? ''), marketOn: asset ? d.marketOn : k === 'electronice' }))
  }
  const depKind = sec === 'goods' && kind !== 'casa' && kind !== 'teren'

  const coinWallet = !!asset?.coins?.length
  async function save() {
    if (coinWallet && asset && !quick) {
      if (!name.trim()) return setErr('Scrie un nume, de ex. „Revolut Crypto”.')
      try { await st.saveAsset({ id: asset.id, name: name.trim(), platform: platform.trim(), note: note.trim() }); notify('Salvat'); onClose() }
      catch (e: any) { setErr(e?.message || 'Nu s-a putut salva.') }
      return
    }
    if (parts.length) {
      const parsed = parseParts(parts)
      if (typeof parsed === 'string') return setErr(parsed)
      if (!quick && !name.trim()) return setErr('Scrie un nume, de ex. „BT Pay”.')
      const v = parsed.reduce((t, p) => t + p.value, 0), inv = parsed.reduce((t, p) => t + p.invested, 0)
      const changed = !asset || asset.value !== v
      try {
        await st.saveAsset(quick && asset
          ? { id: asset.id, parts: parsed, value: v, invested: inv, updated_on: todayIso(), value_source: 'manual' }
          : { id: asset?.id, name: name.trim(), kind, platform: platform.trim(), currency, value: v, invested: inv, parts: parsed, note: note.trim(), archived: false,
              ...(changed ? { updated_on: todayIso(), value_source: 'manual' as const } : {}) })
        notify('Salvat'); onClose()
      } catch (e: any) { setErr(e?.message || 'Nu s-a putut salva.') }
      return
    }
    let v = parseMoney(value)
    if (!value.trim() && !quick && depKind) {
      // No current value typed: use the estimate from the purchase price.
      const pp = parseMoney(dep.price)
      if (pp && dep.date) v = estimateOn(todayIso(), Number(dep.rate) || 0, { day: dep.date, value: pp, source: 'purchase' })
    }
    if (v === null || v < 0) return setErr(sec === 'debt' ? 'Scrie cât mai ai de dat (ex. 15.000,00).' : 'Scrie valoarea actuală (ex. 15.000,00).')
    const inv = sec === 'invest' ? (invested.trim() ? parseMoney(invested) : 0) : 0
    if (inv === null || inv < 0) return setErr('Suma investită nu e validă.')
    if (!quick && !name.trim()) return setErr('Scrie un nume, de ex. „Revolut” sau „Dacia Logan”.')
    let extra: Partial<Asset> = {}
    if (!quick && depKind) {
      const pp = dep.price.trim() ? parseMoney(dep.price) : null
      if (dep.price.trim() && (pp === null || pp <= 0)) return setErr('Prețul de cumpărare nu e valid.')
      if (pp && !dep.date) return setErr('Alege și data când l-ai cumpărat.')
      const rate = dep.rate ? Math.min(90, Number(dep.rate)) : null
      if (dep.marketOn && !dep.query.trim()) return setErr('Scrie modelul exact, ca să-l pot căuta online.')
      extra = {
        purchase_price: pp, purchase_date: pp ? dep.date : null, dep_rate: rate || null,
        market_on: dep.marketOn, market_query: dep.marketOn ? dep.query.trim() : (dep.query.trim() || null),
        market_discount: Math.min(50, Number(dep.discount) || 0),
      }
    }
    const changed = !asset || asset.value !== v
    try {
      await st.saveAsset(quick && asset
        ? { id: asset.id, value: v, updated_on: todayIso(), value_source: 'manual' }
        : { id: asset?.id, name: name.trim(), kind, platform: platform.trim(), currency, value: v, invested: inv, note: note.trim(), archived: false, ...extra,
            ...(changed ? { updated_on: todayIso(), value_source: 'manual' as const } : {}) })
      notify('Valoare actualizată'); onClose()
    } catch (e: any) { setErr(e?.message || 'Nu s-a putut salva.') }
  }

  if (quick && asset && parts.length) {
    return (
      <Sheet title={`Actualizează: ${asset.name}`} onClose={onClose}>
        <p className="hint">Cât valorează azi fiecare?</p>
        {parts.map((p, i) => (
          <div key={i} className="part-quick">
            <label className="field">{p.name}</label>
            <MoneyField id={'part-q-' + i} value={p.value} onChange={x => setParts(ps => ps.map((q, j) => j === i ? { ...q, value: x } : q))} suffix={CUR_LABEL[asset.currency]} />
          </div>
        ))}
        {err && <p className="err">{err}</p>}
        <div className="actions"><button type="button" className="primary" onClick={save}>Actualizează</button></div>
      </Sheet>
    )
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
        <select id="asset-kind" value={kind} onChange={e => changeKind(e.target.value)}>
          {SECTIONS.map(s => (
            <optgroup key={s.id} label={s.name}>
              {ASSET_KINDS.filter(k => k.section === s.id).map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="field">Nume<input id="asset-name" maxLength={50} placeholder={kind === 'electronice' ? 'ex. Samsung S25 Ultra' : sec === 'goods' ? 'ex. Dacia Logan 2019' : sec === 'debt' ? 'ex. Leasing mașină' : 'ex. Revolut'} value={name} onChange={e => { setName(e.target.value); if (!asset && kind === 'electronice' && (!dep.query || dep.query === name)) setDepState(d => ({ ...d, query: e.target.value })) }} /></label>
      {(sec === 'liquid' || sec === 'invest') && <>
        <label className="field">Unde (aplicație / bancă)<input id="asset-platform" maxLength={40} value={platform} onChange={e => setPlatform(e.target.value)} /></label>
        <div className="chips">{PLATFORMS.map(p => <button key={p} type="button" className="chip" aria-pressed={p === platform} onClick={() => setPlatform(p)}>{p}</button>)}</div>
      </>}
      {!coinWallet && <Seg label="Moneda" value={currency} onChange={setCurrency} options={[{ id: 'RON', label: 'Lei' }, { id: 'EUR', label: 'Euro' }, { id: 'USD', label: 'Dolari' }]} />}
      {coinWallet ? <p className="hint">Valoarea se calculează singură din monedele tale și prețurile Revolut X. Le modifici din ecranul portofelului.</p> : asset?.holdings?.length ? <InvestPanel asset={st.assets.find(x => x.id === asset.id) ?? asset} notify={notify} /> : parts.length ? <PartsEditor parts={parts} setParts={setParts} currency={currency} /> : <>
      <label className="field">{sec === 'debt' ? 'Cât mai ai de dat' : 'Valoare actuală'}</label>
      <MoneyField id="asset-value" big value={value} onChange={setValue} suffix={CUR_LABEL[currency]} />
      {sec === 'goods' && !depKind && <p className="hint">Pune cât ai lua pe el dacă l-ai vinde azi (caută anunțuri cu ceva asemănător). Actualizează-l o dată la câteva luni.</p>}
      {depKind && <DepreciationFields v={dep} set={setDep} currency={currency} onUseEstimate={x => setValue(fmtNum(x))} />}
      {depKind && asset && (asset.market_on || asset.dep_rate || asset.purchase_price) ? <AssetValuePanel asset={st.assets.find(x => x.id === asset.id) ?? asset} notify={notify} /> : null}
      {sec === 'invest' && <>
        <label className="field">Cât ai băgat în total (opțional)</label>
        <MoneyField id="asset-invested" value={invested} onChange={setInvested} suffix={CUR_LABEL[currency]} />
        <p className="hint">Din diferența dintre valoare și cât ai băgat se calculează profitul.</p>
        <button type="button" className="ghost-btn" onClick={() => setParts([{ name: name.trim() || 'Rândul 1', value, invested, note: '' }, { name: '', value: '', invested: '', note: '' }])}><Plus size={16} />Împarte pe rânduri (ex. două fonduri)</button>
      </>}
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

/* ---------- One entry split into rows (e.g. BT Pay = BT Index + Pensia Mea) ---------- */

type PartDraft = { name: string; value: string; invested: string; note: string }
const toDraft = (p: AssetPart): PartDraft => ({ name: p.name, value: fmtNum(p.value), invested: p.invested ? fmtNum(p.invested) : '', note: p.note ?? '' })
function parseParts(ps: PartDraft[]): AssetPart[] | string {
  const out: AssetPart[] = []
  for (const [i, p] of ps.entries()) {
    if (!p.name.trim()) return `Scrie un nume pentru rândul ${i + 1}.`
    const v = parseMoney(p.value), inv = p.invested.trim() ? parseMoney(p.invested) : 0
    if (v === null || v < 0) return `Valoarea pentru „${p.name.trim()}” nu e validă.`
    if (inv === null || inv < 0) return `Suma investită pentru „${p.name.trim()}” nu e validă.`
    out.push({ name: p.name.trim(), value: v, invested: inv, ...(p.note.trim() ? { note: p.note.trim() } : {}) })
  }
  return out
}

function PartsEditor({ parts, setParts, currency }: { parts: PartDraft[]; setParts: (f: (p: PartDraft[]) => PartDraft[]) => void; currency: Currency }) {
  const [open, setOpen] = useState<number | null>(() => (parts.some(p => !p.name) ? parts.findIndex(p => !p.name) : null))
  const set = (i: number, patch: Partial<PartDraft>) => setParts(ps => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const vals = parts.map(p => ({ v: parseMoney(p.value) ?? 0, inv: parseMoney(p.invested) ?? 0 }))
  const total = vals.reduce((t, x) => t + x.v, 0), totalInv = vals.reduce((t, x) => t + x.inv, 0)
  const pct = (v: number, inv: number) => (inv ? Math.round(((v - inv) / inv) * 1000) / 10 : null)
  const P = ({ p }: { p: number | null }) => p === null ? null : <span className={'num small ' + (p >= 0 ? 'in' : 'bad')}>{p >= 0 ? '+' : ''}{String(p).replace('.', ',')}%</span>
  return (
    <div className="parts">
      {parts.map((p, i) => (
        <div key={i} className={'part' + (open === i ? ' open' : '')}>
          <button type="button" className="part-head" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
            <span className="row-main"><b>{p.name || 'Rând nou'}</b>{p.note && <span className="muted small">{p.note}</span>}</span>
            <span className="row-side"><b className="num">{fmtNum(vals[i].v)} {CUR_LABEL[currency]}</b>{vals[i].inv ? <span className="muted small num">investit {fmtNum(vals[i].inv)}</span> : null}<P p={pct(vals[i].v, vals[i].inv)} /></span>
            <ChevronDown size={16} className="chev" />
          </button>
          {open === i && <div className="part-edit">
            <label className="field">Nume<input maxLength={50} value={p.name} placeholder="ex. BT Index ROTX" onChange={e => set(i, { name: e.target.value })} /></label>
            <label className="field">Valoare actuală</label>
            <MoneyField id={'part-v-' + i} value={p.value} onChange={x => set(i, { value: x })} suffix={CUR_LABEL[currency]} />
            <label className="field">Cât ai băgat</label>
            <MoneyField id={'part-i-' + i} value={p.invested} onChange={x => set(i, { invested: x })} suffix={CUR_LABEL[currency]} />
            <label className="field">Notă<input maxLength={120} value={p.note} placeholder="opțional (unități, VUAN…)" onChange={e => set(i, { note: e.target.value })} /></label>
            <button type="button" className="ghost-btn" onClick={() => { setParts(ps => ps.filter((_, j) => j !== i)); setOpen(null) }}><Trash2 size={16} />Scoate rândul</button>
          </div>}
        </div>
      ))}
      <button type="button" className="ghost-btn" onClick={() => { setParts(ps => [...ps, { name: '', value: '', invested: '', note: '' }]); setOpen(parts.length) }}><Plus size={16} />Adaugă rând</button>
      <div className="part-total">
        <span>Total</span>
        <span className="row-side"><b className="num">{fmtNum(total)} {CUR_LABEL[currency]}</b>{totalInv ? <span className="muted small num">investit {fmtNum(totalInv)}</span> : null}<P p={pct(total, totalInv)} /></span>
      </div>
    </div>
  )
}
