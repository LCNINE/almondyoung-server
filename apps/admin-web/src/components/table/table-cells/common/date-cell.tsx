import { PlaceholderCell } from './placeholder-cell'

type DateCellProps = {
  value: string | Date | null | undefined
  /** 날짜 + 시:분 까지 표시(기본 false: 날짜만) */
  withTime?: boolean
}

export const DateCell = ({ value, withTime = false }: DateCellProps) => {
  if (value == null) return <PlaceholderCell />
  const date = new Date(value)
  if (!withTime) {
    return <span>{date.toLocaleDateString('ko-KR')}</span>
  }
  return (
    <span className="whitespace-nowrap tabular-nums">
      {date.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })}
    </span>
  )
}
