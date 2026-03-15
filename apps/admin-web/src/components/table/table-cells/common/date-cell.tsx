import { PlaceholderCell } from './placeholder-cell'

type DateCellProps = {
  value: string | Date | null | undefined
}

export const DateCell = ({ value }: DateCellProps) => {
  if (value == null) return <PlaceholderCell />
  return <span>{new Date(value).toLocaleDateString('ko-KR')}</span>
}
