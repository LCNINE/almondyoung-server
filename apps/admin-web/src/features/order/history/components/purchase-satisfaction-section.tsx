'use client';

import Link from 'next/link';
import { Can } from '@/components/auth/can';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Stars } from '@/features/cs/purchase-satisfaction/components/stars';
import { formatKstTime } from '@/features/cs/purchase-satisfaction/period';
import { PURCHASE_SATISFACTION_REASON_LABELS } from '@/features/cs/purchase-satisfaction/reason-labels';
import { useCan } from '@/hooks/use-permission';
import {
  usePurchaseSatisfactionByOrder,
  useSetPurchaseSatisfactionChecked,
} from '@/lib/services/purchase-satisfaction';

export function PurchaseSatisfactionSection({
  medusaOrderId,
}: {
  medusaOrderId: string;
}) {
  const can = useCan(['cs.satisfaction.read']);
  if (can.status !== 'ready' || !can.allowed) return null;
  return <SatisfactionBody key={medusaOrderId} medusaOrderId={medusaOrderId} />;
}

function SatisfactionBody({ medusaOrderId }: { medusaOrderId: string }) {
  const {
    data: item,
    isPending,
    isError,
  } = usePurchaseSatisfactionByOrder(medusaOrderId);
  const setChecked = useSetPurchaseSatisfactionChecked();

  return (
    <section aria-label="구매 만족도" className="space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="font-medium">구매 만족도</h4>
        {item && item.rating <= 3 && (
          <Badge variant={item.checkedAt ? 'secondary' : 'outline'}>
            {item.checkedAt ? '확인함' : '확인 전'}
          </Badge>
        )}
      </div>
      {isPending ? (
        <p className="text-gray-500">불러오는 중이에요.</p>
      ) : isError ? (
        <p className="text-sm text-destructive">만족도를 불러오지 못했어요.</p>
      ) : item ? (
        <>
          <div className="flex items-center gap-2">
            <Stars rating={item.rating} withLabel />
            <span className="text-xs text-gray-500">
              {formatKstTime(item.updatedAt)}
            </span>
          </div>
          {item.reasons.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.reasons.map((reason) => (
                <Badge key={reason} variant="outline">
                  {PURCHASE_SATISFACTION_REASON_LABELS[reason]}
                </Badge>
              ))}
            </div>
          )}
          {item.memo && <p className="whitespace-pre-wrap">{item.memo}</p>}
          <Can run={useSetPurchaseSatisfactionChecked}>
            <Button
              size="sm"
              variant={item.checkedAt ? 'outline' : 'default'}
              disabled={setChecked.isPending}
              onClick={() =>
                setChecked.mutate({ id: item.id, checked: !item.checkedAt })
              }
            >
              {item.checkedAt ? '확인 취소' : '확인했어요'}
            </Button>
          </Can>
          {setChecked.isError && (
            <p className="text-sm text-destructive">
              확인 처리에 실패했어요. 다시 시도해 주세요.
            </p>
          )}
        </>
      ) : (
        <p className="text-gray-500">아직 응답이 없어요.</p>
      )}
      <Link
        href="/cs/purchase-satisfaction"
        className="inline-block text-sm text-blue-600 hover:underline"
      >
        만족도 목록에서 보기
      </Link>
    </section>
  );
}
