'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const PRESETS = [
  { label: '1,000원', amount: 1000 },
  { label: '10,000원', amount: 10000 },
  { label: '50,000원', amount: 50000 },
];

function StatusToast() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const status = searchParams.get('status');
    if (status === 'succeeded') toast.success('결제 완료!');
    if (status === 'canceled') toast.info('결제 취소됨');
    if (status) router.replace('/dev/store', { scroll: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export default function DevStorePage() {
  const router = useRouter();
  const [userId, setUserId] = useState('dev-user-1');
  const [amount, setAmount] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);

  async function handleBuy(buyAmount: number) {
    if (!userId.trim()) {
      toast.error('userId를 입력하세요');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/dev/intents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId.trim(),
          amount: buyAmount,
          currency: 'KRW',
          returnUrl: `${window.location.origin}/dev/store`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.message ?? '결제 생성 실패');
        return;
      }
      router.push(`/pay/${data.intentId}`);
    } catch {
      toast.error('네트워크 오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  }

  function handleCustomBuy() {
    if (!amount || amount <= 0) {
      toast.error('금액을 입력하세요');
      return;
    }
    handleBuy(amount);
  }

  return (
    <>
      <Suspense>
        <StatusToast />
      </Suspense>

      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">테스트 상점</h1>
          <p className="text-sm text-muted-foreground mt-1">
            임의 금액으로 결제 플로우를 테스트합니다.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="userId">User ID</Label>
          <Input
            id="userId"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="dev-user-1"
            className="max-w-xs"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">빠른 구매</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-3 flex-wrap">
            {PRESETS.map((preset) => (
              <Button
                key={preset.amount}
                variant="outline"
                disabled={loading}
                onClick={() => handleBuy(preset.amount)}
              >
                {preset.label}
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">직접 입력</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-3 items-end">
            <div className="space-y-2">
              <Label htmlFor="amount">금액 (KRW)</Label>
              <Input
                id="amount"
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value ? Number(e.target.value) : '')}
                placeholder="예: 3000"
                className="w-40"
                onKeyDown={(e) => e.key === 'Enter' && handleCustomBuy()}
              />
            </div>
            <Button onClick={handleCustomBuy} disabled={loading || !amount}>
              구매하기
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
