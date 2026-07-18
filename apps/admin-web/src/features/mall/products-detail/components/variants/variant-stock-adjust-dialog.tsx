'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAdjustStock,
  useSkuWarehouseStock,
  useWarehouses,
} from '@/lib/services/inventory';
import { matchingQueryKeys } from '@/lib/services/matching';
import { StockAdjustForm } from '@/features/inventory/components/stock-adjust-form';
import type { ProductVariantTableRow } from '@/hooks/table/columns/use-product-variants-table-columns';
import { toast } from 'sonner';

type Props = {
  variant: ProductVariantTableRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * 품목 행에서 여는 재고 조정 다이얼로그.
 * 판매가능수량을 직접 쓰는 게 아니라, 매칭된 SKU × 선택 창고에 ADJUST 이벤트를 쏜다.
 * 창고는 재고 요약이 아니라 전체 창고 목록(useWarehouses)에서 고르므로, 재고 0인 신규
 * 품목도 첫 입고(0→N)가 가능하다. (재고현황 뷰의 zero 제외와 무관)
 */
export function VariantStockAdjustDialog({ variant, open, onOpenChange }: Props) {
  const links = variant?.matchingInfo?.matching?.links ?? [];
  const queryClient = useQueryClient();
  const { data: warehouses = [] } = useWarehouses();
  const adjustMutation = useAdjustStock();

  const [skuId, setSkuId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');

  // 열릴 때 초기화. SKU가 하나뿐이면 자동 선택.
  useEffect(() => {
    if (!open) return;
    const currentLinks = variant?.matchingInfo?.matching?.links ?? [];
    setSkuId(currentLinks.length === 1 ? currentLinks[0].skuId : '');
    setWarehouseId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, variant?.id]);

  const { data: currentStock } = useSkuWarehouseStock(skuId, warehouseId);
  const currentQuantity =
    skuId && warehouseId ? currentStock?.summary?.currentQuantity ?? 0 : null;

  const handleSubmit = async (delta: number, reason: string) => {
    try {
      await adjustMutation.mutateAsync({ skuId, warehouseId, delta, reason });
      // 판매가능수량은 품목 화면의 matching batch로 계산되므로 재조회시켜야 갱신됨.
      await queryClient.invalidateQueries({
        queryKey: matchingQueryKeys.variantMatchingBatches(),
      });
      toast.success('재고가 조정되었습니다.');
      onOpenChange(false);
    } catch {
      toast.error('재고 조정에 실패했습니다.');
    }
  };

  const skuLabel = (link: (typeof links)[number]) =>
    link.skuCode ?? link.skuName ?? link.skuId;

  const noSku = links.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>재고 조정 — {variant?.variantName ?? variant?.id}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {noSku ? (
            <p className="text-sm text-destructive">
              매칭된 SKU가 없어 재고를 조정할 수 없습니다. 먼저 매칭을 설정하세요.
            </p>
          ) : links.length === 1 ? (
            <p className="text-sm text-muted-foreground">
              SKU:{' '}
              <span className="font-mono text-foreground">
                {skuLabel(links[0])}
              </span>
            </p>
          ) : (
            <div className="space-y-2">
              <Label>SKU</Label>
              <Select value={skuId} onValueChange={setSkuId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="SKU 선택" />
                </SelectTrigger>
                <SelectContent>
                  {links.map((link) => (
                    <SelectItem key={link.skuId} value={link.skuId}>
                      {skuLabel(link)}
                      {link.quantity > 1 ? ` (구성 ${link.quantity})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!noSku && (
            <div className="space-y-2">
              <Label>창고</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="창고 선택" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {!noSku && (
          <StockAdjustForm
            currentQuantity={currentQuantity}
            pending={adjustMutation.isPending}
            disabled={!skuId || !warehouseId}
            resetKey={`${skuId}|${warehouseId}`}
            onSubmit={handleSubmit}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
