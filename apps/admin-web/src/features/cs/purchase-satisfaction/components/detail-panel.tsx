'use client';

import Link from 'next/link';
import { Can } from '@/components/auth/can';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSetPurchaseSatisfactionChecked } from '@/lib/services/purchase-satisfaction';
import type { PurchaseSatisfactionDto } from '@/lib/types/dto/purchase-satisfaction';
import { formatKstTime } from '../period';
import { PURCHASE_SATISFACTION_REASON_LABELS } from '../reason-labels';
import { Stars } from './stars';

export function DetailPanel({ item, onClose }: { item: PurchaseSatisfactionDto; onClose: () => void }) {
  const setChecked = useSetPurchaseSatisfactionChecked();
  const isLow = item.rating <= 3;

  return (
    <aside aria-label="응답 상세" className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-base font-bold">#{item.orderDisplayId}</p>
          <p className="text-xs text-muted-foreground">{formatKstTime(item.updatedAt)}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          닫기
        </Button>
      </div>
      <Stars rating={item.rating} withLabel />
      {item.reasons.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.reasons.map((reason) => (
            <Badge key={reason} variant="outline">
              {PURCHASE_SATISFACTION_REASON_LABELS[reason]}
            </Badge>
          ))}
        </div>
      )}
      {item.memo && <p className="whitespace-pre-wrap text-sm">{item.memo}</p>}
      <div className="flex flex-wrap gap-2">
        {isLow && (
          <Can run={useSetPurchaseSatisfactionChecked}>
            <Button
              size="sm"
              variant={item.checkedAt ? 'outline' : 'default'}
              disabled={setChecked.isPending}
              onClick={() => setChecked.mutate({ id: item.id, checked: !item.checkedAt })}
            >
              {item.checkedAt ? '확인 취소' : '확인했어요'}
            </Button>
          </Can>
        )}
        <Button asChild size="sm" variant="outline">
          <Link href={`/order/history?orderNo=${item.orderDisplayId}`}>주문내역에서 열기</Link>
        </Button>
      </div>
      {setChecked.isError && <p className="text-sm text-destructive">확인 처리에 실패했어요. 다시 시도해 주세요.</p>}
    </aside>
  );
}
