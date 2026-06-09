'use client';

import { useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal, ChevronLeft, ChevronRight } from 'lucide-react';
import { useFulfillments } from '@/lib/services/orders';
import { useWarehouses } from '@/lib/services/inventory/queries';
import { FoStatusBadge } from '../fo-status-badge';
import type {
  FulfillmentOrder,
  FulfillmentOrderStatus,
  FulfillmentMode,
  FulfillmentOrderPriority,
} from '@/lib/types/dto/fulfillment';

const PAGE_SIZE = 20;

const PRIORITY_LABELS: Record<FulfillmentOrderPriority, string> = {
  normal: '일반',
  high: '높음',
  urgent: '긴급',
};

const PRIORITY_VARIANTS: Record<FulfillmentOrderPriority, 'default' | 'secondary' | 'destructive'> = {
  normal: 'secondary',
  high: 'default',
  urgent: 'destructive',
};

const MODE_LABELS: Record<FulfillmentMode, string> = {
  in_house: '자체배송',
  '3pl': '3PL',
  drop_ship: '직배',
};

const FO_STATUSES: FulfillmentOrderStatus[] = [
  'created', 'reserving', 'ready', 'unfulfillable', 'pending', 'allocated',
  'picking', 'picked', 'inspecting', 'labeled', 'invoiced', 'forwarded',
  'shipped', 'completed', 'canceled',
];

function truncateId(id: string) {
  return `${id.substring(0, 8)}…`;
}

function RowActions({ fo }: { fo: FulfillmentOrder }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">작업 메뉴</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem asChild>
          <Link href={`/order/fulfillments/${fo.id}`}>상세 보기</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {fo.batchId && (
          <DropdownMenuItem asChild>
            <Link href={`/order/outbound-batches?batchId=${fo.batchId}`}>출고 배치</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href="/order/picking-list">피킹리스트</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/order/inspection">검수발송</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/order/shipment-round">송장/출고</Link>
        </DropdownMenuItem>
        {fo.fulfillmentMode === 'drop_ship' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`/order/direct-ship?foId=${fo.id}`}>직배송 운영</Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FulfillmentsTable() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { data: warehouses = [] } = useWarehouses();

  const status = searchParams.get('status') ?? '';
  const warehouseId = searchParams.get('warehouseId') ?? '';
  const fulfillmentMode = searchParams.get('fulfillmentMode') ?? '';
  const priority = searchParams.get('priority') ?? '';
  const salesOrderId = searchParams.get('salesOrderId') ?? '';
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      if (key !== 'page') params.delete('page');
      router.replace(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname]
  );

  const { data: fulfillments = [], isLoading } = useFulfillments({
    status: status || undefined,
    warehouseId: warehouseId || undefined,
    fulfillmentMode: (fulfillmentMode || undefined) as FulfillmentMode | undefined,
    priority: (priority || undefined) as FulfillmentOrderPriority | undefined,
    salesOrderId: salesOrderId || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const warehouseMap = Object.fromEntries(warehouses.map((w) => [w.id, w.name]));
  const hasNext = fulfillments.length === PAGE_SIZE;
  const hasPrev = page > 1;

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status || 'all'} onValueChange={(v) => updateParam('status', v === 'all' ? '' : v)}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="상태 전체" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상태</SelectItem>
            {FO_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={warehouseId || 'all'} onValueChange={(v) => updateParam('warehouseId', v === 'all' ? '' : v)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="전체 창고" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 창고</SelectItem>
            {warehouses.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={fulfillmentMode || 'all'} onValueChange={(v) => updateParam('fulfillmentMode', v === 'all' ? '' : v)}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="전체 모드" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 모드</SelectItem>
            <SelectItem value="in_house">자체배송</SelectItem>
            <SelectItem value="3pl">3PL</SelectItem>
            <SelectItem value="drop_ship">직배</SelectItem>
          </SelectContent>
        </Select>

        <Select value={priority || 'all'} onValueChange={(v) => updateParam('priority', v === 'all' ? '' : v)}>
          <SelectTrigger className="w-28">
            <SelectValue placeholder="우선순위" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 우선순위</SelectItem>
            <SelectItem value="normal">일반</SelectItem>
            <SelectItem value="high">높음</SelectItem>
            <SelectItem value="urgent">긴급</SelectItem>
          </SelectContent>
        </Select>

        <Input
          placeholder="판매주문 ID"
          value={salesOrderId}
          onChange={(e) => updateParam('salesOrderId', e.target.value)}
          className="w-44"
        />
      </div>

      {/* 테이블 */}
      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">로딩 중...</p>
      ) : fulfillments.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          풀필먼트 오더가 없습니다.
        </p>
      ) : (
        <div className="overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">FO ID</TableHead>
                <TableHead className="w-28">판매주문</TableHead>
                <TableHead>모드</TableHead>
                <TableHead>창고</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>우선순위</TableHead>
                <TableHead className="text-right">수량</TableHead>
                <TableHead className="text-right">예약수량</TableHead>
                <TableHead>배치</TableHead>
                <TableHead>직배 상태</TableHead>
                <TableHead>송장/추적</TableHead>
                <TableHead>생성일</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {fulfillments.map((fo: FulfillmentOrder) => (
                <TableRow
                  key={fo.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/order/fulfillments/${fo.id}`)}
                >
                  <TableCell className="font-mono text-xs">
                    {truncateId(fo.id)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {fo.salesOrderId ? truncateId(fo.salesOrderId) : '-'}
                  </TableCell>
                  <TableCell>
                    {fo.fulfillmentMode ? (
                      <span className="text-sm">{MODE_LABELS[fo.fulfillmentMode]}</span>
                    ) : '-'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {fo.warehouseId ? (warehouseMap[fo.warehouseId] ?? truncateId(fo.warehouseId)) : '-'}
                  </TableCell>
                  <TableCell>
                    <FoStatusBadge status={fo.status} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={PRIORITY_VARIANTS[fo.priority]}>
                      {PRIORITY_LABELS[fo.priority]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fo.totalQty}</TableCell>
                  <TableCell className="text-right tabular-nums">{fo.totalReservedQty}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {fo.batch ? truncateId(fo.batch.id) : '-'}
                  </TableCell>
                  <TableCell>
                    {fo.directShipStatus ? (
                      <span className="text-sm">{fo.directShipStatus}</span>
                    ) : '-'}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {fo.invoice?.invoiceNumber ?? fo.shipment?.trackingNo ?? '-'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(fo.createdAt).toLocaleDateString('ko-KR')}
                  </TableCell>
                  <TableCell
                    onClick={(e) => e.stopPropagation()}
                  >
                    <RowActions fo={fo} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 페이지네이션 */}
      {(hasPrev || hasNext) && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!hasPrev}
            onClick={() => updateParam('page', String(page - 1))}
          >
            <ChevronLeft className="mr-1 h-3.5 w-3.5" />
            이전
          </Button>
          <span className="text-sm text-muted-foreground">{page} 페이지</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNext}
            onClick={() => updateParam('page', String(page + 1))}
          >
            다음
            <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
