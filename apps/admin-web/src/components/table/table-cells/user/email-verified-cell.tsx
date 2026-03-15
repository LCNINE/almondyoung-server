import { PlaceholderCell } from '../common/placeholder-cell'

type EmailVerifiedCellProps = {
  value: boolean | null | undefined
}

export const EmailVerifiedCell = ({ value }: EmailVerifiedCellProps) => {
  if (value == null) return <PlaceholderCell />
  return <span>{value ? '인증' : '미인증'}</span>
}
