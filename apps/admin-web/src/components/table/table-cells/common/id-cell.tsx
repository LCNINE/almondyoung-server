'use client'

import { Copy } from '@/components/admin-ui-experimental/copy/copy'
import { PlaceholderCell } from './placeholder-cell'

type IdCellProps = {
  value: string | null | undefined
}

export const IdCell = ({ value }: IdCellProps) => {
  if (value == null) return <PlaceholderCell />
  return (
    <span className="flex items-center gap-1">
      <span className="font-mono text-xs">
        {value.slice(0, 4)}...{value.slice(-4)}
      </span>
      <Copy content={value} className="text-muted-foreground" />
    </span>
  )
}
