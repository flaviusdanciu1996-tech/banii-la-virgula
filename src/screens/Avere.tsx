import { useMemo } from 'react'
import { Plus, RefreshCw, FileUp, Radar as RadarIcon, Sparkles, NotebookPen, CalendarCheck, Landmark } from 'lucide-react'
import type { Nav } from '../App.tsx'
import { useStore } from '../store.tsx'
import { Donut, LineChart, CatIcon } from '../ui.tsx'
import { Icon } from '../icons.tsx'
import { fmt, fmtNum, fmtSigned, toRon, CUR_LABEL } from '../lib/money.ts'
import { todayIso, diffDays, MONTHS_SHORT } from '../lib/period.ts'
import { netWorth, snapshotAt, monthlySeries } from '../lib/calc.ts'
import { SECTIONS, kindOf, type Asset, type AssetSection, type Goal } from '../lib/types.ts'
import { GoalsSection } from './Plans.tsx'
import { BrokerSummaryCard } from './BrokerImport.tsx'
import { FiCard } from './Fi.tsx'
import { cryptoSummary } from './Crypto.tsx'
import { CountUp, EmptyArt } from '../ui.tsx'

export function AvereScreen({ scope, openAsset, openGoal, nav }: { scope: 'all' | 'me'; openAsset: (a?: Asset, section?: AssetSection, quick?: boolean) => void; openGoal: (g?: Goal, add?: boolean) => void; nav: Nav }) {
  const st = useStore()
  const today = todayIso()
  const assets = useMemo(() => st.assets.filter(a => !a.archived && (scope === 'all' || a.owner_id === st.user.id)), [st.assets, scope, st.user.id])
  const nw = netWorth(assets, st.rates)
  const monthAgo = scope === 'all' ? snapshotAt(st.snapshots, new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)) : null
  const series = monthlySeries(st.snapshots, today, 12).map(p => ({ label: MONTHS_SHORT[Number(p.label.slice(5, 7)) - 1], value: p.value }))
  const parts = [
    { value: nw.liquid, color: 'var(--s-liquid)', label: 'Lichidități' },
    { value: nw.invest, color: 'var(--s-invest)', label: 'Investiții' },
    { value: nw.goods, color: 'var(--s-goods)', label: 'Bunuri' },
  ]

  return (
    <div className="screen">
      <header className="hello"><div><h1>Avere</h1><p className="muted">Tot ce ai, adunat într-o cifră</p></div></header>

      <section className="card budget">
        <div className="eyebrow">Averea netă</div>
        <div className={'big' + (nw.net < 0 ? ' neg' : '')}><CountUp v={nw.net} /></div>
        {monthAgo && <div className={'num small ' + (nw.net - monthAgo.net >= 0 ? 'in' : 'bad')}>{fmtSigned(nw.net - monthAgo.net)} față de acum o lună</div>}
        <div className="nw-split">
          <Donut parts={parts} size={112} />
          <div className="nw-legend">
            {SECTIONS.map(s => {
              const v = s.id === 'liquid' ? nw.liquid : s.id === 'invest' ? nw.invest : s.id === 'goods' ? nw.goods : nw.debts
              return <div key={s.id}><span><i style={{ background: s.color }} />{s.name}</span><b className={'num' + (s.id === 'debt' && v ? ' bad' : '')}>{s.id === 'debt' && v ? '−' : ''}{fmtNum(v)}</b></div>
            })}
          </div>
        </div>
        <p className="note">Curs {st.settings.rates_date ? `din ${st.settings.rates_date.split('-').reverse().join('.')}` : 'manual'}: 1 € = {String(st.rates.EUR).replace('.', ',')} lei · 1 $ = {String(st.rates.USD).replace('.', ',')} lei</p>
      </section>

      <FiCard />

      <GoalsSection openGoal={openGoal} />

      {assets.length === 0 ? (
        <EmptyArt icon="gem" title="Adaugă primul lucru pe care îl ai" text="Un cont (Revolut, banca), o investiție (Tradeville, Binance), mașina sau o datorie. Le aduni pe toate și vezi cât valorezi de fapt.">
          <button type="button" className="primary" onClick={() => openAsset()}><Plus size={17} /> Adaugă</button>
          <button type="button" className="link" onClick={() => nav('import-broker')}><FileUp size={15} /> Import din Tradeville</button>
        </EmptyArt>
      ) : <>
        <section className="card">
          <h2>Evoluția averii</h2>
          <LineChart points={series} />
        </section>

        {SECTIONS.map(s => {
          const items = assets.filter(a => kindOf(a.kind).section === s.id)
          const total = items.reduce((acc, a) => acc + toRon(a.value, a.currency, st.rates), 0)
          return (
            <section key={s.id}>
              <h2 className="grp-h"><span><i className="dot" style={{ background: s.color }} />{s.name}</span><span className="num">{s.id === 'debt' && total ? '−' : ''}{fmtNum(total)}</span></h2>
              {s.id === 'invest' && items.some(a => a.invest_summary) && <BrokerSummaryCard assets={items.filter(a => a.invest_summary)} />}
              {s.id === 'invest' && items.some(a => !a.invest_summary && a.invested > 0) && (() => {
                const other = items.filter(a => !a.invest_summary && a.invested > 0)
                const rows = other.map(a => ({ id: a.id, name: a.name, inv: toRon(a.invested, a.currency, st.rates), val: toRon(a.value, a.currency, st.rates) }))
                const inv = rows.reduce((t, r) => t + r.inv, 0), val = rows.reduce((t, r) => t + r.val, 0)
                const lei = (v: number) => fmtNum(Math.round(v / 100) * 100).replace(',00', '')
                const Line = ({ name, inv, val, total }: { name: string; inv: number; val: number; total?: boolean }) => {
                  const pr = val - inv, pct = inv ? Math.round((pr / inv) * 1000) / 10 : 0
                  return (
                    <div className={'oi-row' + (total ? ' total' : '')}>
                      <div className="oi-l"><b>{name}</b><span className="muted small">pus {lei(inv)} → acum {lei(val)} lei</span></div>
                      <div className="oi-r"><b className={'num ' + (pr >= 0 ? 'in' : 'bad')}>{pr >= 0 ? '+' : '−'}{lei(Math.abs(pr))} lei</b><span className={'num small ' + (pr >= 0 ? 'in' : 'bad')}>{pr >= 0 ? '+' : ''}{String(pct).replace('.', ',')}%</span></div>
                    </div>
                  )
                }
                return (
                  <div className="card other-inv">
                    <h3>{items.some(a => a.invest_summary) ? 'Celelalte investiții (fără Tradeville)' : 'Investițiile tale'}</h3>
                    {rows.map(r => <Line key={r.id} name={r.name} inv={r.inv} val={r.val} />)}
                    {rows.length > 1 && <Line name="Total" inv={inv} val={val} total />}
                  </div>
                )
              })()}
              <div className="rows">
                {items.map(a => a.kind === 'crypto'
                  ? <AssetRow key={a.id} a={a} today={today} onOpen={() => nav('crypto', { id: a.id })} onQuick={() => nav('crypto', { id: a.id })} />
                  : <AssetRow key={a.id} a={a} today={today} onOpen={() => openAsset(a)} onQuick={() => openAsset(a, undefined, !a.holdings?.length)} />)}
                <button type="button" className="row add-line" onClick={() => openAsset(undefined, s.id)}><Plus size={16} />Adaugă la {s.name.toLowerCase()}</button>
                {s.id === 'invest' && <button type="button" className="row add-line" onClick={() => nav('import-broker')}><FileUp size={16} />Import din Tradeville</button>}
                {s.id === 'invest' && <button type="button" className="row add-line plan-line" onClick={() => nav('plan')}><CalendarCheck size={16} />Planul lunii · ce cumpăr acum</button>}
                {s.id === 'invest' && <button type="button" className="row add-line" onClick={() => nav('radar')}><RadarIcon size={16} />Radar BVB · scoruri și analize</button>}
                {s.id === 'invest' && <button type="button" className="row add-line" onClick={() => nav('rapoarte', { tab: 'fiscal' })}><Landmark size={16} />Rapoarte și taxe · CASS, impozite</button>}
                {s.id === 'invest' && <button type="button" className="row add-line" onClick={() => nav('jurnal')}><NotebookPen size={16} />Jurnal de investiții · istoric decizii</button>}
                {s.id === 'invest' && <button type="button" className="row add-line" onClick={() => nav('asistent')}><Sparkles size={16} />Asistent investiții</button>}
              </div>
            </section>
          )
        })}
      </>}
    </div>
  )
}

function AssetRow({ a, today, onOpen, onQuick }: { a: Asset; today: string; onOpen: () => void; onQuick: () => void }) {
  const st = useStore()
  const k = kindOf(a.kind)
  const age = diffDays(a.updated_on, today)
  const auto = (k.section === 'goods' && (a.market_on || !!a.dep_rate)) || !!a.holdings?.length || !!a.coins?.length
  const stale = age > 30 && !auto
  const lost = a.purchase_price ? Math.round((1 - a.value / a.purchase_price) * 100) : null
  const how = a.parts?.length ? a.parts.map(p => p.name.replace(/\s*\(.*\)$/, '').split(/\s+/).slice(0, 2).join(' ')).join(' + ') : a.coins?.length ? cryptoSummary(a) : a.holdings?.length ? `${a.holdings.length} acțiuni · preț BVB` : a.value_source === 'market' ? `preț online · ${(a.market_offers ?? []).filter(o => o.used).length} oferte`
    : a.value_source === 'depreciation' ? `estimat · −${a.dep_rate}%/an` : null
  const ron = toRon(a.value, a.currency, st.rates)
  const profitPct = k.section === 'invest' && a.invested && !a.invest_summary ? Math.round(((a.value - a.invested) / a.invested) * 1000) / 10 : null
  return (
    <div className="row asset-row">
      <button type="button" className="asset-main" onClick={onOpen}>
        <CatIcon icon={k.icon} color={SECTIONS.find(x => x.id === k.section)!.color} />
        <span className="row-main">
          <b>{a.name}</b>
          <span className="muted small">{[a.platform, k.name].filter(Boolean).join(' · ')}</span>
          <span className={'small upd ' + (stale ? 'warn' : 'muted')}>{how ? how + ' · ' : ''}{age <= 0 ? 'actualizat azi' : `acum ${age} ${age === 1 ? 'zi' : 'zile'}`}{auto && !how ? ' · se actualizează lunar' : ''}</span>
        </span>
        <span className="row-side">
          <b className={'num' + (k.section === 'debt' ? ' bad' : '')}>{k.section === 'debt' ? '−' : ''}{fmtNum(a.value)} {CUR_LABEL[a.currency]}</b>
          {a.currency !== 'RON' && <span className="num muted small">≈ {fmt(ron)}</span>}
          {lost !== null && lost > 0 && <span className="num small bad">−{lost}% din preț</span>}
          {profitPct !== null && <span className={'num small ' + (profitPct >= 0 ? 'in' : 'bad')}>{profitPct >= 0 ? '+' : ''}{String(profitPct).replace('.', ',')}%</span>}
        </span>
      </button>
      <button type="button" className={'icon-btn refresh' + (stale ? ' stale' : '')} style={auto ? { opacity: .55 } : undefined} aria-label={`Actualizează valoarea pentru ${a.name}`} onClick={onQuick}><RefreshCw size={16} /></button>
    </div>
  )
}
