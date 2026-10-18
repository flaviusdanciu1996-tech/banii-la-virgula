import { useMemo } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { useStore } from '../store.tsx'
import { Donut, LineChart, CatIcon } from '../ui.tsx'
import { Icon } from '../icons.tsx'
import { fmt, fmtNum, fmtSigned, toRon, CUR_LABEL } from '../lib/money.ts'
import { todayIso, diffDays, MONTHS_SHORT } from '../lib/period.ts'
import { netWorth, snapshotAt, monthlySeries } from '../lib/calc.ts'
import { SECTIONS, kindOf, type Asset, type AssetSection, type Goal } from '../lib/types.ts'
import { GoalsSection } from './Plans.tsx'
import { CountUp, EmptyArt } from '../ui.tsx'

export function AvereScreen({ scope, openAsset, openGoal }: { scope: 'all' | 'me'; openAsset: (a?: Asset, section?: AssetSection, quick?: boolean) => void; openGoal: (g?: Goal, add?: boolean) => void }) {
  const st = useStore()
  const today = todayIso()
  const assets = useMemo(() => st.assets.filter(a => !a.archived && (scope === 'all' || a.owner_id === st.user.id)), [st.assets, scope, st.user.id])
  const nw = netWorth(assets, st.rates)
  const monthAgo = scope === 'all' ? snapshotAt(st.snapshots, new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)) : null
  const series = monthlySeries(st.snapshots, today, 12).map(p => ({ label: MONTHS_SHORT[Number(p.label.slice(5, 7)) - 1], value: p.value }))
  const profit = nw.investValue - nw.invested
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

      <GoalsSection openGoal={openGoal} />

      {assets.length === 0 ? (
        <EmptyArt icon="gem" title="Adaugă primul lucru pe care îl ai" text="Un cont (Revolut, banca), o investiție (Tradeville, Binance), mașina sau o datorie. Le aduni pe toate și vezi cât valorezi de fapt.">
          <button type="button" className="primary" onClick={() => openAsset()}><Plus size={17} /> Adaugă</button>
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
              {s.id === 'invest' && items.length > 0 && (
                <div className="card inv-sum">
                  <div><span>Ai băgat</span><b className="num">{fmtNum(nw.invested)}</b></div>
                  <div><span>Valorează</span><b className="num">{fmtNum(nw.investValue)}</b></div>
                  <div><span>Profit</span><b className={'num ' + (profit >= 0 ? 'in' : 'bad')}>{fmtSigned(profit).replace(' lei', '')}{nw.invested ? ` (${profit >= 0 ? '+' : ''}${(Math.round((profit / nw.invested) * 1000) / 10).toString().replace('.', ',')}%)` : ''}</b></div>
                </div>
              )}
              <div className="rows">
                {items.map(a => <AssetRow key={a.id} a={a} today={today} onOpen={() => openAsset(a)} onQuick={() => openAsset(a, undefined, true)} />)}
                <button type="button" className="row add-line" onClick={() => openAsset(undefined, s.id)}><Plus size={16} />Adaugă la {s.name.toLowerCase()}</button>
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
  const stale = age > 30
  const ron = toRon(a.value, a.currency, st.rates)
  const profitPct = k.section === 'invest' && a.invested ? Math.round(((a.value - a.invested) / a.invested) * 1000) / 10 : null
  return (
    <div className="row asset-row">
      <button type="button" className="asset-main" onClick={onOpen}>
        <CatIcon icon={k.icon} color={SECTIONS.find(x => x.id === k.section)!.color} />
        <span className="row-main">
          <b>{a.name}</b>
          <span className="muted small">{[a.platform, k.name].filter(Boolean).join(' · ')}</span>
          <span className={'small upd ' + (stale ? 'warn' : 'muted')}>{age <= 0 ? 'actualizat azi' : `actualizat acum ${age} ${age === 1 ? 'zi' : 'zile'}`}</span>
        </span>
        <span className="row-side">
          <b className={'num' + (k.section === 'debt' ? ' bad' : '')}>{k.section === 'debt' ? '−' : ''}{fmtNum(a.value)} {CUR_LABEL[a.currency]}</b>
          {a.currency !== 'RON' && <span className="num muted small">≈ {fmt(ron)}</span>}
          {profitPct !== null && <span className={'num small ' + (profitPct >= 0 ? 'in' : 'bad')}>{profitPct >= 0 ? '+' : ''}{String(profitPct).replace('.', ',')}%</span>}
        </span>
      </button>
      <button type="button" className={'icon-btn refresh' + (stale ? ' stale' : '')} aria-label={`Actualizează valoarea pentru ${a.name}`} onClick={onQuick}><RefreshCw size={16} /></button>
    </div>
  )
}
