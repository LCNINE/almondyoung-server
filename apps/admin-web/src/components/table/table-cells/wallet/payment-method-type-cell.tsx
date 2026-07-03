'use client';

import { PlaceholderCell } from '../common/placeholder-cell';

const methodTypeLabels: Record<string, string> = {
  TOSS: '토스페이먼츠',
  POINTS: '적립금',
  BANK_TRANSFER: '무통장입금',
};

export function PaymentMethodTypeCell({
  value,
  tossVirtualAccount,
}: {
  value: string | null | undefined;
  /** BANK_TRANSFER 중 토스 가상계좌 발급 건이면 true (구 직접입금 건과 구분) */
  tossVirtualAccount?: boolean;
}) {
  if (!value) return <PlaceholderCell />;
  const label =
    value === 'BANK_TRANSFER' && tossVirtualAccount
      ? '토스 가상계좌'
      : (methodTypeLabels[value] ?? value);
  return <span className="text-sm">{label}</span>;
}
