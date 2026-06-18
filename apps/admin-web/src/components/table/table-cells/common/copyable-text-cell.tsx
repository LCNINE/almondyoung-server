'use client';

import { Copy } from '@/components/admin-ui-experimental/common/copy/copy';
import { PlaceholderCell } from './placeholder-cell';

type CopyableTextCellProps = {
  value: string | null | undefined;
};

export const CopyableTextCell = ({ value }: CopyableTextCellProps) => {
  if (value == null || value === '') return <PlaceholderCell />;
  return (
    <span className="flex items-center gap-1">
      <span>{value}</span>
      <Copy content={value} className="-m-1.5 rounded p-1.5 " />
    </span>
  );
};
