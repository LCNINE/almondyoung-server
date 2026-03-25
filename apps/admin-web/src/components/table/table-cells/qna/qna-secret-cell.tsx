'use client';

import { LockIcon } from 'lucide-react';

type QnaSecretCellProps = {
  value: boolean | null | undefined;
};

export function QnaSecretCell({ value }: QnaSecretCellProps) {
  if (!value) return <span className="text-muted-foreground">-</span>;
  return <LockIcon className="h-4 w-4 text-muted-foreground" />;
}
