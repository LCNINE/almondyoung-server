'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { confirmPaymentIntent, cancelPaymentIntent } from '@/lib/wallet-api';
import type { PaymentIntent, PaymentMethod } from '@/lib/wallet-api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';

const METHOD_TYPE_LABELS: Record<string, string> = {
  POINTS: '포인트',
  CARD: '카드',
  BANK_TRANSFER: '계좌이체',
  BNPL: '후불결제',
};

function formatAmount(amount: number, currency: string): string {
  if (currency === 'KRW') {
    return `${amount.toLocaleString('ko-KR')}원`;
  }
  return `${amount.toLocaleString()} ${currency}`;
}

interface Props {
  intent: PaymentIntent;
  methods: PaymentMethod[];
  clientSecret: string;
}

export function PayForm({ intent, methods, clientSecret }: Props) {
  const router = useRouter();
  const [selectedMethodId, setSelectedMethodId] = useState<string>(methods[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isCanceling, startCancelTransition] = useTransition();

  const handleConfirm = () => {
    if (!selectedMethodId) return;
    setError(null);

    startTransition(async () => {
      try {
        const result = await confirmPaymentIntent(intent.id, selectedMethodId, clientSecret);
        if (result.status === 'SUCCEEDED') {
          const destination = intent.returnUrl
            ? `${intent.returnUrl}?payment_intent_id=${intent.id}&status=succeeded`
            : `/pay/${intent.id}?client_secret=${clientSecret}`;
          router.replace(destination);
        } else {
          // PROCESSING or REQUIRES_ACTION — reload to sync state
          router.refresh();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '결제에 실패했어요. 다시 시도해주세요.');
      }
    });
  };

  const handleCancel = () => {
    startCancelTransition(async () => {
      try {
        await cancelPaymentIntent(intent.id, clientSecret);
        const destination = intent.returnUrl
          ? `${intent.returnUrl}?payment_intent_id=${intent.id}&status=canceled`
          : `/pay/${intent.id}?client_secret=${clientSecret}`;
        router.replace(destination);
      } catch (err) {
        setError(err instanceof Error ? err.message : '취소에 실패했어요.');
      }
    });
  };

  const expiresAt = intent.expiresAt ? new Date(intent.expiresAt) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">결제하기</CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Amount */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">결제 금액</span>
          <span className="text-2xl font-bold tabular-nums">
            {formatAmount(intent.payableAmount, intent.currency)}
          </span>
        </div>

        {expiresAt && (
          <p className="text-xs text-muted-foreground">
            만료: {expiresAt.toLocaleString('ko-KR')}
          </p>
        )}

        <Separator />

        {/* Payment methods */}
        {methods.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            사용 가능한 결제수단이 없어요.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium">결제수단</p>
            <RadioGroup value={selectedMethodId} onValueChange={setSelectedMethodId}>
              {methods.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-3 rounded-md border p-3 cursor-pointer has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                >
                  <RadioGroupItem value={m.id} id={m.id} />
                  <Label htmlFor={m.id} className="flex-1 cursor-pointer">
                    <span className="font-medium">
                      {METHOD_TYPE_LABELS[m.type] ?? m.type}
                    </span>
                    {m.displayName && (
                      <span className="ml-2 text-sm text-muted-foreground">{m.displayName}</span>
                    )}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        )}

        {/* Error */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>

      <CardFooter className="flex flex-col gap-2">
        <Button
          className="w-full"
          size="lg"
          onClick={handleConfirm}
          disabled={!selectedMethodId || isPending || isCanceling}
        >
          {isPending ? '처리 중...' : `${formatAmount(intent.payableAmount, intent.currency)} 결제하기`}
        </Button>
        <Button
          variant="ghost"
          className="w-full text-muted-foreground"
          onClick={handleCancel}
          disabled={isPending || isCanceling}
        >
          {isCanceling ? '취소 중...' : '취소'}
        </Button>
      </CardFooter>
    </Card>
  );
}
