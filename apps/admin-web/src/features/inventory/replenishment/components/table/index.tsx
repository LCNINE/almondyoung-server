'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useReplenishmentSuggestions,
  useAddToCart,
  useCreateTransferOrder,
} from '@/lib/services/inventory';
import type {
  ReplenishmentSuggestionRowDto,
  SuggestionActionFilter,
} from '@/lib/types/dto/inventory';
import { toast } from 'sonner';
import {
  FLAG_LABELS,
  purchaseAction,
  summarizeActions,
  toCartPayload,
  toTransferPayload,
  transferAction,
  urgencyLabel,
} from '../../suggestion-model';
import { ReplenishmentSkuDrawer } from '../sku-drawer';

const FILTERS: Array<{ value: SuggestionActionFilter; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'purchase', label: '발주' },
  { value: 'transfer', label: '이동' },
];

export function ReplenishmentTable() {
  const [action, setAction] = useState<SuggestionActionFilter>('all');
  const [detailSkuId, setDetailSkuId] = useState<string | null>(null);
  const { data, isLoading, isError } = useReplenishmentSuggestions(action);
  const addToCart = useAddToCart();
  const createTransfer = useCreateTransferOrder();

  const handleCart = async (row: ReplenishmentSuggestionRowDto) => {
    const purchase = purchaseAction(row);
    if (!purchase) return;
    try {
      // C 단계엔 출발 창고 정보가 없어 유형을 해외로 둔다 — 카트에서 바꿀 수 있다.
      await addToCart.mutateAsync(toCartPayload(row, purchase, 'foreign'));
      toast.success(`${row.skuName} ${purchase.qty}개를 카트에 담았습니다.`);
    } catch {
      toast.error('카트 담기에 실패했습니다.');
    }
  };

  const handleTransfer = async (row: ReplenishmentSuggestionRowDto) => {
    const transfer = transferAction(row);
    if (!transfer) return;
    try {
      const { transferOrderId } = await createTransfer.mutateAsync(
        toTransferPayload(row, transfer, '보충 제안')
      );
      toast.success(
        `이동 지시서 초안을 만들었습니다 (${transferOrderId.slice(0, 8)}…).`
      );
    } catch {
      toast.error(
        '이동 지시서 생성에 실패했습니다. 재고 원장 조정 권한이 필요합니다.'
      );
    }
  };

  const rows = data?.items ?? [];

  return (
    <>
      <div className="flex items-center justify-between px-4 pt-4">
        <Tabs
          value={action}
          onValueChange={(v) =>
            setAction(FILTERS.find((f) => f.value === v)?.value ?? 'all')
          }
        >
          <TabsList>
            {FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value}>
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {data && (
          <p className="text-xs text-muted-foreground">
            판정 {data.evaluated} · 제안 {rows.length}
          </p>
        )}
      </div>

      {isError ? (
        <p className="p-4 text-sm text-destructive">
          제안을 불러오지 못했습니다. 판매 창고가 하나인지 확인하세요.
        </p>
      ) : isLoading ? (
        <p className="p-4 text-sm text-muted-foreground">로딩 중...</p>
      ) : rows.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">제안이 없습니다.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>판매창고 재고</TableHead>
              <TableHead>긴급도</TableHead>
              <TableHead>전사 위치</TableHead>
              <TableHead>제안</TableHead>
              <TableHead>플래그</TableHead>
              <TableHead className="text-right">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.skuId}
                className="cursor-pointer"
                onClick={() => setDetailSkuId(row.skuId)}
              >
                <TableCell>
                  <div className="font-medium">{row.skuName}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.skuCode}
                    {row.supplier ? ` · ${row.supplier.name}` : ''}
                  </div>
                </TableCell>
                <TableCell>
                  {row.sellable.onHand}
                  <span className="text-xs text-muted-foreground">
                    {' '}
                    / 예약 {row.sellable.reserved} · 이동중{' '}
                    {row.sellable.inTransit}
                  </span>
                </TableCell>
                <TableCell>{urgencyLabel(row)}</TableCell>
                <TableCell>
                  {row.company.position}
                  <span className="text-xs text-muted-foreground">
                    {' '}
                    / 발주잔량 {row.company.onOrder}
                  </span>
                </TableCell>
                <TableCell>{summarizeActions(row)}</TableCell>
                <TableCell className="space-x-1">
                  {row.flags.map((flag) => (
                    <Badge key={flag} variant="outline">
                      {FLAG_LABELS[flag]}
                    </Badge>
                  ))}
                </TableCell>
                <TableCell
                  className="space-x-1 text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  {purchaseAction(row) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={addToCart.isPending}
                      onClick={() => {
                        void handleCart(row);
                      }}
                    >
                      카트
                    </Button>
                  )}
                  {transferAction(row) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={createTransfer.isPending}
                      onClick={() => {
                        void handleTransfer(row);
                      }}
                    >
                      이동 초안
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ReplenishmentSkuDrawer
        skuId={detailSkuId}
        onOpenChange={(open) => {
          if (!open) setDetailSkuId(null);
        }}
      />
    </>
  );
}
