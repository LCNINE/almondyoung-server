'use client';

import { PlaceholderCell } from '../common/placeholder-cell';

const methodTypeLabels: Record<string, string> = {
  TOSS: '토스페이먼츠',
  POINTS: '포인트',
  BANK_TRANSFER: '무통장입금',
};

export function PaymentMethodTypeCell({ value }: { value: string | null | undefined }) {
  if (!value) return <PlaceholderCell />;
  return <span className="text-sm">{methodTypeLabels[value] ?? value}</span>;
}
