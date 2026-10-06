'use client';

import { useEffect } from 'react';
import { completePaymentPreference } from '@/lib/payment-preference';

/** 결제 승인이 완료된 서버 페이지에서만 렌더링한다. */
export function TossSuccessRedirect({ intentId, target }: { intentId: string; target: string }) {
  useEffect(() => {
    completePaymentPreference(intentId);
    window.location.replace(target);
  }, [intentId, target]);
  return <main className="p-6 text-center text-sm text-muted-foreground">결제가 완료되었습니다. 이동 중입니다.</main>;
}
