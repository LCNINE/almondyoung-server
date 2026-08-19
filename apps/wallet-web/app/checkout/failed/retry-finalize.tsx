'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

import { finalizeOrder } from '../finalize';

interface Props {
  intentId: string;
  region: string;
  orderListUrl: string;
}

export function RetryFinalize({ intentId, region, orderListUrl }: Props) {
  const [loading, setLoading] = useState(false);

  async function retry() {
    if (!intentId) {
      window.location.href = orderListUrl;
      return;
    }
    setLoading(true);
    const result = await finalizeOrder(intentId);
    if (result.type === 'error') {
      toast.error('아직 주문이 만들어지지 않았어요. 잠시 후 다시 시도해 주세요.');
      setLoading(false);
      return;
    }
    if (result.type === 'awaiting_deposit') {
      window.location.href = orderListUrl;
      return;
    }
    const origin = orderListUrl.split(`/${region}/`)[0];
    window.location.href = `${origin}/${region}/checkout/success/${intentId}${
      result.orderId ? `?orderId=${encodeURIComponent(result.orderId)}` : ''
    }`;
  }

  return (
    <div className="space-y-2">
      <Button className="w-full" onClick={retry} disabled={loading}>
        {loading ? '확인 중...' : '다시 시도'}
      </Button>
      <Button variant="outline" className="w-full" onClick={() => (window.location.href = orderListUrl)}>
        주문 내역 확인
      </Button>
    </div>
  );
}
