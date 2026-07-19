'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  createIdempotentCommand,
  getServerDenyMessage,
  isCarrierSupported,
  isWaybillFailed,
  isWaybillIssued,
  isWaybillPendingIssue,
  useBatchIssueWaybills,
  useFulfillmentShipments,
  useFulfillments,
  WAYBILL_CARRIERS,
} from '@/lib/services/orders';
import type { BatchResultItem, CarrierCode } from '@/lib/types/dto/fulfillment';

export default function WaybillIssueTemplate() {
  const fulfillments = useFulfillments();
  const [foId, setFoId] = useState('');
  const shipments = useFulfillmentShipments(foId);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [carrier, setCarrier] = useState<CarrierCode>('HANJIN');
  const [results, setResults] = useState<BatchResultItem[]>([]);
  const batch = useBatchIssueWaybills();

  const plannedShipments = useMemo(
    () => (shipments.data ?? []).filter((s) => s.status === 'planned'),
    [shipments.data]
  );
  const selectedIds = Object.entries(selected)
    .filter(([, v]) => v)
    .map(([id]) => id);

  const runBatch = async () => {
    if (!selectedIds.length) {
      toast.error('발급할 shipment 를 선택하세요.');
      return;
    }
    if (!isCarrierSupported(carrier)) {
      toast.error('현재 지원되는 택배사는 HANJIN 뿐입니다.');
      return;
    }
    const key = createIdempotentCommand({}).idempotencyKey;
    try {
      const res = await batch.mutateAsync({
        data: { shipmentIds: selectedIds, carrier },
        idempotencyKey: key,
      });
      setResults(res);
      const issued = res.filter((r) => isWaybillIssued(r.status)).length;
      const pending = res.filter((r) => isWaybillPendingIssue(r.status)).length;
      const failed = res.filter((r) => isWaybillFailed(r.status)).length;
      const summary = `일괄 발급 — 총 ${res.length}건 (완료 ${issued}, 진행중 ${pending}, 실패 ${failed}).`;
      if (pending || failed) toast.warning(summary);
      else toast.success(summary);
    } catch (error) {
      toast.error(getServerDenyMessage(error, '일괄 발급 요청 실패'));
    }
  };

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-lg font-semibold">운송장 일괄 발급</h1>
        <p className="text-sm text-muted-foreground">
          FO 를 선택하면 planned shipment 를 골라 한 번에 발급합니다.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label className="text-sm">주문처리(FO)</label>
          <Select value={foId} onValueChange={setFoId}>
            <SelectTrigger className="w-[320px]">
              <SelectValue placeholder="FO 선택" />
            </SelectTrigger>
            <SelectContent>
              {(fulfillments.data?.data ?? []).map((fo) => (
                <SelectItem key={fo.id} value={fo.id}>
                  {fo.id} · {fo.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm">택배사</label>
          <Select value={carrier} onValueChange={(v) => setCarrier(v as CarrierCode)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WAYBILL_CARRIERS.map((c) => (
                <SelectItem key={c} value={c} disabled={!isCarrierSupported(c)}>
                  {c}
                  {isCarrierSupported(c) ? '' : ' (미지원)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={runBatch} disabled={batch.isPending || !selectedIds.length}>
          {batch.isPending ? '발급 중...' : `선택 ${selectedIds.length}건 일괄발급`}
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>shipment</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="text-right">수량</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plannedShipments.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Checkbox
                    checked={!!selected[s.id]}
                    onCheckedChange={(c) =>
                      setSelected((prev) => ({ ...prev, [s.id]: c === true }))
                    }
                  />
                </TableCell>
                <TableCell className="font-mono text-xs">{s.id}</TableCell>
                <TableCell>
                  <Badge variant="outline">{s.status}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{s.totalQty}</TableCell>
              </TableRow>
            ))}
            {foId && plannedShipments.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                  planned 상태 shipment 가 없습니다.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {results.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">발급 결과</h2>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>shipment</TableHead>
                  <TableHead>결과</TableHead>
                  <TableHead>운송장번호</TableHead>
                  <TableHead>사유</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r) => (
                  <TableRow key={r.shipmentId}>
                    <TableCell className="font-mono text-xs">{r.shipmentId}</TableCell>
                    <TableCell>
                      <Badge
                        variant={r.status === 'failed' ? 'destructive' : 'outline'}
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.trackingNo ?? '-'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.reason ?? '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
