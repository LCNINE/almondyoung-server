'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useIndividualInbound } from '@/lib/services/inventory';
import { toast } from 'sonner';

type Props = {
  warehouseId: string;
  onSuccess: () => void;
};

export function IndividualMode({ warehouseId, onSuccess }: Props) {
  const [skuId, setSkuId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [locationId, setLocationId] = useState('');
  const [memo, setMemo] = useState('');
  const mutation = useIndividualInbound();

  const handleSubmit = async () => {
    if (!skuId.trim() || quantity < 1) {
      toast.error('SKU ID와 수량을 입력해 주세요.');
      return;
    }
    try {
      await mutation.mutateAsync({
        warehouseId,
        skuId: skuId.trim(),
        quantity,
        locationId: locationId.trim() || undefined,
        memo: memo.trim() || undefined,
      });
      toast.success('개별입고가 처리되었습니다.');
      onSuccess();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '입고 처리에 실패했습니다.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label>SKU ID</Label>
          <Input
            placeholder="SKU ID 입력"
            value={skuId}
            onChange={(e) => setSkuId(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>수량</Label>
          <Input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>로케이션 ID (선택)</Label>
          <Input
            placeholder="지정하지 않으면 기본 입고존"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label>메모 (선택)</Label>
          <Input
            placeholder="메모"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>
      </div>

      <Button onClick={handleSubmit} disabled={mutation.isPending}>
        {mutation.isPending ? '처리 중…' : '입고 처리'}
      </Button>
    </div>
  );
}
