'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { getServerDenyMessage } from '@/lib/api/server-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Can } from '@/components/auth/can';
import { usePermissionCheck } from '@/hooks/use-permission';
import {
  useDirectShipCancelNotices,
  useExportDirectShipCancelNoticesFile,
  useMarkDirectShipCancelNoticesNotified,
} from '@/lib/services/orders';
import { groupBySupplier, isOverdue } from './cancel-notice-view';

function elapsed(createdAt: string, now: Date): string {
  const h = Math.floor(
    (now.getTime() - new Date(createdAt).getTime()) / 3600_000
  );
  return h >= 24
    ? `${Math.floor(h / 24)}일 ${h % 24}시간`
    : `${Math.max(h, 0)}시간`;
}

export function CancelNoticesPanel() {
  const { canRun } = usePermissionCheck();
  const { data, isLoading } = useDirectShipCancelNotices();
  const exportFile = useExportDirectShipCancelNoticesFile();
  const markNotified = useMarkDirectShipCancelNoticesNotified();
  const [picked, setPicked] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 렌더마다 현재 시각으로 — 메모에 가두면 화면을 연 채 시간이 지나도 «하루 넘음» 이 갱신되지 않는다
  const now = new Date();
  const groups = groupBySupplier(data ?? [], now);
  const group = groups.find((g) => g.supplierId === picked) ?? groups[0];

  if (isLoading) return null;
  if (!group) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        알릴 취소가 없습니다.
      </div>
    );
  }

  const chosen = group.rows.filter((r) => selected.has(r.id));
  const allChecked = chosen.length === group.rows.length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleExport = async () => {
    try {
      const blob = await exportFile.mutateAsync({
        supplierId: group.supplierId,
        noticeIds: chosen.map((r) => r.id),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${group.companyName}_알릴취소_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(getServerDenyMessage(error, 'CSV 내려받기에 실패했습니다.'));
    }
  };

  const handleNotified = async () => {
    try {
      await markNotified.mutateAsync({
        supplierId: group.supplierId,
        noticeIds: chosen.map((r) => r.id),
      });
      setSelected(new Set());
    } catch (error) {
      toast.error(getServerDenyMessage(error, '알림 완료에 실패했습니다.'));
    }
  };

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {groups.map((g) => (
            <Button
              key={g.supplierId}
              size="sm"
              variant={
                g.supplierId === group.supplierId ? 'default' : 'outline'
              }
              onClick={() => {
                setPicked(g.supplierId);
                setSelected(new Set());
              }}
            >
              {g.companyName} {g.rows.length}
              {g.overdueCount > 0 && (
                <span className="ml-1.5 font-semibold text-amber-600 dark:text-amber-400">
                  ·{g.overdueCount}
                </span>
              )}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          {canRun(useExportDirectShipCancelNoticesFile) && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={chosen.length === 0 || exportFile.isPending}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              CSV 내려받기
            </Button>
          )}
          <Can run={useMarkDirectShipCancelNoticesNotified}>
            <Button
              size="sm"
              onClick={handleNotified}
              disabled={chosen.length === 0 || markNotified.isPending}
            >
              알림 완료
            </Button>
          </Can>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <Checkbox
                checked={allChecked}
                onCheckedChange={(v) =>
                  setSelected(
                    v ? new Set(group.rows.map((r) => r.id)) : new Set()
                  )
                }
              />
            </TableHead>
            <TableHead>주문번호</TableHead>
            <TableHead>상품</TableHead>
            <TableHead className="text-right">취소수량</TableHead>
            <TableHead>구분</TableHead>
            <TableHead>취소 시각</TableHead>
            <TableHead>경과</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {group.rows.map((r) => (
            <TableRow
              key={r.id}
              className={
                isOverdue(r.createdAt, now)
                  ? 'bg-amber-50 dark:bg-amber-950/30'
                  : undefined
              }
            >
              <TableCell>
                <Checkbox
                  checked={selected.has(r.id)}
                  onCheckedChange={() => toggle(r.id)}
                />
              </TableCell>
              <TableCell>{r.channelOrderId ?? r.salesOrderId}</TableCell>
              <TableCell>{r.skuName}</TableCell>
              <TableCell className="text-right">{r.canceledQty}</TableCell>
              <TableCell>
                {r.cancellationScope === 'full' ? '전체' : '부분'}
              </TableCell>
              <TableCell>
                {new Date(r.cancelledAt).toLocaleString('ko-KR')}
              </TableCell>
              <TableCell>{elapsed(r.createdAt, now)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
