import { useStore } from './store.tsx'
import { CatIcon, Avatar } from './ui.tsx'
import { fmt, fmtNum, CUR_LABEL } from './lib/money.ts'
import { shortDayLabel } from './lib/period.ts'
import { groupOf, type Category, type Tx } from './lib/types.ts'

export const catColor = (c?: Category | null) => (!c ? 'var(--muted)' : c.kind === 'in' ? 'var(--in)' : groupOf(c.grp)?.color || 'var(--accent)')

/** One transaction row: coloured icon, signed amount (with original currency), category, date, who. */
export function TxRow({ t, onOpen }: { t: Tx; onOpen: (t: Tx) => void }) {
  const st = useStore()
  const c = st.categories.find(x => x.id === t.category_id)
  const name = st.members.find(m => m.user_id === t.member_id)?.display_name || '?'
  const foreign = t.orig_currency && t.orig_currency !== 'RON' && t.orig_amount
  return (
    <button type="button" className="row" onClick={() => onOpen(t)}>
      <CatIcon icon={c?.icon || 'circle'} color={catColor(c)} />
      <span className="row-main">
        <b className={'num' + (t.kind === 'in' ? ' in' : '')}>
          {t.kind === 'in' ? '+' : '−'}{foreign ? `${fmtNum(t.orig_amount!)} ${CUR_LABEL[t.orig_currency!]}` : fmt(t.amount)}
        </b>
        {foreign && <span className="orig num">≈ {fmt(t.amount)}</span>}
        <span className="muted small">{t.receipt_path ? '🧾 ' : ''}{c?.name}{t.note ? ' · ' + t.note : ''}</span>
      </span>
      <span className="row-side"><span className="muted small">{shortDayLabel(t.date)}</span>{st.members.length > 1 && <Avatar name={name} size={24} />}</span>
    </button>
  )
}
