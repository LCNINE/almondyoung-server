'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { confirmPaymentIntent, cancelPaymentIntent } from '@/lib/wallet-api';
import type { PaymentIntent, PaymentMethod } from '@/lib/wallet-api';

interface Props {
  intent: PaymentIntent;
  methods: PaymentMethod[];
}

export function PayForm({ intent, methods }: Props) {
  const router = useRouter();
  const [selectedMethodId, setSelectedMethodId] = useState<string>(methods[0]?.id ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!selectedMethodId) {
      setError('결제 수단을 선택해주세요.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await confirmPaymentIntent(intent.id, selectedMethodId);
      if (result.returnUrl) {
        router.replace(`${result.returnUrl}?payment_intent_id=${intent.id}&status=succeeded`);
      } else {
        router.replace(`/pay/${intent.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '결제에 실패했어요.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    setLoading(true);
    setError(null);
    try {
      await cancelPaymentIntent(intent.id);
      if (intent.returnUrl) {
        router.replace(`${intent.returnUrl}?payment_intent_id=${intent.id}&status=canceled`);
      } else {
        router.replace(`/pay/${intent.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '취소에 실패했어요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">결제하기</h1>
        <p className="text-2xl font-bold mt-1">
          {intent.payableAmount.toLocaleString()} {intent.currency}
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">결제 수단</label>
        {methods.length === 0 ? (
          <p className="text-sm text-muted-foreground">사용 가능한 결제 수단이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {methods.map((m) => (
              <label key={m.id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="method"
                  value={m.id}
                  checked={selectedMethodId === m.id}
                  onChange={() => setSelectedMethodId(m.id)}
                />
                <span className="text-sm">
                  {m.displayName || m.type}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleConfirm}
          disabled={loading || methods.length === 0}
          className="flex-1 py-2 px-4 bg-primary text-primary-foreground rounded-md disabled:opacity-50"
        >
          {loading ? '처리 중...' : '결제하기'}
        </button>
        <button
          onClick={handleCancel}
          disabled={loading}
          className="py-2 px-4 border rounded-md disabled:opacity-50"
        >
          취소
        </button>
      </div>
    </div>
  );
}
