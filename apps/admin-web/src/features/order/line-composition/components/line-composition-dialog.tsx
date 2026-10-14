'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAssignLineComposition } from '@/lib/services/orders/line-composition';
import {
  compositionErrorView,
  type CompositionErrorView,
  type LineCompositionTarget,
} from '../line-composition-view';
import {
  addPicked,
  pickedFromComposition,
  removePicked,
  setPickedQuantity,
  toCompositionItems,
  type PickedSku,
} from '../picked-skus';
import { PickedSkuList, SkuSearchPanel } from './sku-composition-picker';

/** 판매주문 라인 하나의 구성을 이 주문에만 지정한다(#1063 스펙 §7.1). 상품매칭은 바뀌지 않는다 */
export function LineCompositionDialog({
  target,
  onClose,
  currentFulfillmentOrderId,
}: {
  target: LineCompositionTarget | null;
  onClose: () => void;
  currentFulfillmentOrderId?: string;
}) {
  const assign = useAssignLineComposition();
  const [picked, setPicked] = useState<PickedSku[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<CompositionErrorView | null>(null);

  // 같은 라인을 다시 열 때만 초기화한다 — target 객체는 렌더마다 새로 만들어질 수 있어 id 로 건다
  useEffect(() => {
    if (!target) return;
    setPicked(pickedFromComposition(target.composition));
    setQuery(target.productName);
    setError(null);
  }, [target?.salesOrderLineId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) return null;

  const onSave = async () => {
    setError(null);
    try {
      await assign.mutateAsync({
        salesOrderId: target.salesOrderId,
        salesOrderLineId: target.salesOrderLineId,
        body: { items: toCompositionItems(picked) },
      });
      toast.success('이 주문의 구성을 저장했습니다.');
      onClose();
    } catch (e) {
      setError(compositionErrorView(e, { currentFulfillmentOrderId }));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>이 주문만</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-gray-700">
          {target.productName} · 수량 {target.quantity}개
        </div>
        <PickedSkuList
          value={picked}
          emptyText="구성할 재고상품을 추가하세요."
          onRemove={(skuId) => setPicked(removePicked(picked, skuId))}
          onQuantityChange={(skuId, value) => setPicked(setPickedQuantity(picked, skuId, value))}
        />
        <SkuSearchPanel
          query={query}
          onQueryChange={setQuery}
          suggestedQuery={target.productName}
          picked={picked}
          onAdd={(sku) => {
            const result = addPicked(picked, sku);
            if (result.ok) setPicked(result.list);
            else toast.error('이미 추가한 재고상품입니다.');
          }}
        />
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p>{error.message}</p>
            {error.links.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-3">
                {error.links.map((link) => (
                  <Link key={link.href} href={link.href} className="underline">
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            닫기
          </Button>
          <Button onClick={onSave} disabled={picked.length === 0 || assign.isPending}>
            {error?.retry ? '다시 시도' : '저장'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
