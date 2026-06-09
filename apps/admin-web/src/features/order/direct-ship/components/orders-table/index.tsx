'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ExternalLink } from 'lucide-react';
import { useDirectShipOrders } from '@/lib/services/orders';
import { ForwardDialog } from '../forward-dialog';
import { CompleteDialog } from '../complete-dialog';
import { ExportButton } from '../export-button';
import type { DirectShipOrder, DirectShipOrderStatus } from '@/lib/types/dto/fulfillment';

const PAGE_SIZE = 20;

const STATUS_LABELS: Record<DirectShipOrderStatus, string> = {
  pending: '대기',
  forwarded: '공급사 전달',
  completed: '공급사 출고 완료',
  canceled: '취소',
};

const STATUS_VARIANTS: Record<DirectShipOrderStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  pending: 'secondary',
  forwarded: 'default',
  completed: 'outline',
  canceled: 'destructive',
};

export function DirectShipOrdersTable() {
  const searchParams = useSearchParams();
  const highlightFoId = searchParams.get('foId') ?? null;

  const [statusFilter, setStatusFilter] = useState('all');
  const [companyFilter, setCompanyFilter] = useState('');
  const { data: orders = [], isLoading } = useDirectShipOrders({
    status: statusFilter === 'all' ? undefined : statusFilter,
    companyName: companyFilter || undefined,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [forwardOpen, setForwardOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === orders.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(orders.map((o: DirectShipOrder) => o.fulfillmentOrderId)));
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="공급사명 검색"
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value)}
          className="w-44"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="상태 전체" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체</SelectItem>
            <SelectItem value="pending">대기</SelectItem>
            <SelectItem value="forwarded">공급사 전달</SelectItem>
            <SelectItem value="completed">공급사 출고 완료</SelectItem>
          </SelectContent>
        </Select>

        {selected.size > 0 && (
          <div className="ml-auto flex gap-2">
            <span className="flex items-center text-sm text-muted-foreground">
              {selected.size}건 선택
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setForwardOpen(true)}
            >
              공급사 전달
            </Button>
            <Button size="sm" onClick={() => setCompleteOpen(true)}>
              공급사 출고 완료
            </Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">로딩 중...</p>
      ) : orders.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          직배송 주문이 없습니다.
        </p>
      ) : (
        <div className="overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={selected.size === orders.length && orders.length > 0}
                    onCheckedChange={toggleAll}
                  />
                </TableHead>
                <TableHead>공급사</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>우선순위</TableHead>
                <TableHead className="text-right">수량</TableHead>
                <TableHead>발송일</TableHead>
                <TableHead>FO</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.slice(0, PAGE_SIZE).map((order: DirectShipOrder) => (
                <TableRow
                  key={order.fulfillmentOrderId}
                  className={
                    highlightFoId === order.fulfillmentOrderId
                      ? 'bg-muted/60 ring-1 ring-inset ring-ring'
                      : undefined
                  }
                >
                  <TableCell>
                    <Checkbox
                      checked={selected.has(order.fulfillmentOrderId)}
                      onCheckedChange={() => toggle(order.fulfillmentOrderId)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{order.companyName}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[order.status]}>
                      {STATUS_LABELS[order.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>{order.priority}</TableCell>
                  <TableCell className="text-right">{order.totalQty}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {order.forwardedAt
                      ? new Date(order.forwardedAt).toLocaleDateString('ko-KR')
                      : '-'}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/order/fulfillments/${order.fulfillmentOrderId}`}
                      className="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      {order.fulfillmentOrderId.substring(0, 8)}…
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </TableCell>
                  <TableCell>
                    {order.status === 'forwarded' && (
                      <ExportButton companyName={order.companyName} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ForwardDialog
        foIds={Array.from(selected)}
        open={forwardOpen}
        onOpenChange={(open) => {
          setForwardOpen(open);
          if (!open) setSelected(new Set());
        }}
      />
      <CompleteDialog
        foIds={Array.from(selected)}
        open={completeOpen}
        onOpenChange={(open) => {
          setCompleteOpen(open);
          if (!open) setSelected(new Set());
        }}
      />
    </div>
  );
}
