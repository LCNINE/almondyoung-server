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
  PurchaseOrderType,
  ReplenishmentSuggestionRowDto,
  SuggestionActionFilter,
} from '@/lib/types/dto/inventory';
import { toast } from 'sonner';
import {
  FLAG_LABELS,
  PATTERN_LABELS,
  PO_TYPE_LABELS,
  daysOfCoverLabel,
  httpStatusOf,
  purchaseAction,
  serverMessageOf,
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

const PO_TYPES: Array<{ value: PurchaseOrderType; label: string }> = [
  { value: 'foreign', label: PO_TYPE_LABELS.foreign },
  { value: 'domestic', label: PO_TYPE_LABELS.domestic },
];

export function ReplenishmentTable() {
  const [action, setAction] = useState<SuggestionActionFilter>('all');
  const [poType, setPoType] = useState<PurchaseOrderType>('foreign');
  const [detailSkuId, setDetailSkuId] = useState<string | null>(null);
  const { data, isLoading, isError, error } =
    useReplenishmentSuggestions(action);
  const addToCart = useAddToCart();
  const createTransfer = useCreateTransferOrder();

  const handleCart = async (row: ReplenishmentSuggestionRowDto) => {
    const purchase = purchaseAction(row);
    if (!purchase) return;
    try {
      // 발주 유형은 카트에서 못 바꾼다 — 여기서 고른 값이 그대로 PO 에 찍힌다.
      await addToCart.mutateAsync(toCartPayload(row, purchase, poType));
      toast.success(
        `${row.skuName} ${purchase.qty}개를 ${PO_TYPE_LABELS[poType]} 발주 카트에 담았습니다.`
      );
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
    } catch (e) {
      const status = httpStatusOf(e);
      const serverMessage = serverMessageOf(e);
      if (status === 403) {
        toast.error(
          '이동 지시서 생성에 실패했습니다. 재고 원장 조정 권한이 필요합니다.'
        );
      } else if (serverMessage) {
        toast.error(serverMessage);
      } else {
        toast.error('이동 지시서 생성에 실패했습니다.');
      }
    }
  };

  const rows = data?.items ?? [];

  return (
    <>
      <div className="flex items-center justify-between px-4 pt-4">
        <div className="flex items-center gap-4">
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
          <Tabs
            value={poType}
            onValueChange={(v) =>
              setPoType(PO_TYPES.find((t) => t.value === v)?.value ?? 'foreign')
            }
          >
            <TabsList>
              {PO_TYPES.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  발주 유형: {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        {data && (
          <p className="text-xs text-muted-foreground">
            판정 {data.evaluated} · 제안 {data.total}
            {data.total > rows.length ? ` · 상위 ${rows.length}개 표시` : ''}
          </p>
        )}
      </div>

      {isError ? (
        <p className="p-4 text-sm text-destructive">
          {httpStatusOf(error) === 409
            ? '제안을 불러오지 못했습니다. 판매 창고가 하나인지 확인하세요.'
            : '제안을 불러오지 못했습니다.'}
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
              <TableHead>패턴 / 등급</TableHead>
              <TableHead>판매창고 재고</TableHead>
              <TableHead>예상 커버</TableHead>
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
                  <Badge variant="secondary">
                    {PATTERN_LABELS[row.pattern]}
                  </Badge>{' '}
                  <span className="text-xs">{row.grade}</span>
                </TableCell>
                <TableCell>
                  {row.sellable.onHand}
                  <span className="text-xs text-muted-foreground">
                    {' '}
                    / 예약 {row.sellable.reserved} · 이동중{' '}
                    {row.sellable.inTransit}
                  </span>
                </TableCell>
                <TableCell>
                  {daysOfCoverLabel(row)}
                  <span className="text-xs text-muted-foreground">
                    {' '}
                    · {urgencyLabel(row)}
                  </span>
                </TableCell>
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
                      disabled={
                        addToCart.isPending &&
                        addToCart.variables?.skuId === row.skuId
                      }
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
                      disabled={
                        createTransfer.isPending &&
                        createTransfer.variables?.lines?.[0]?.skuId ===
                          row.skuId
                      }
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
