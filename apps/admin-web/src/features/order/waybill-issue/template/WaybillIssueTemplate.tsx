'use client';

import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
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
import { ConsolidationSheet } from '@/features/order/fulfillments/detail/consolidation-sheet';
import { defaultWarehouseId } from '@/features/order/consolidation/board-model';
import { useWarehouses } from '@/lib/services/inventory/queries';
import {
  createIdempotentCommand,
  getServerDenyMessage,
  isCarrierSupported,
  isWaybillFailed,
  isWaybillIssued,
  isWaybillPendingIssue,
  useBatchIssueWaybills,
  useConsolidationBoard,
  usePlannedShipments,
  WAYBILL_CARRIERS,
  isWaybillWaitingRetry,
  retryNoticeOf,
} from '@/lib/services/orders';
import type { BatchResultItem, CarrierCode } from '@/lib/types/dto/fulfillment';
import { Can } from '@/components/auth/can';
import { useCan } from '@/hooks/use-permission';
import { permissionLabel } from '@/lib/auth/permission-labels';
import { MergeWarning } from '../merge-warning';
import {
  BATCH_ISSUE_LIMIT,
  PLANNED_LIST_LIMIT,
  filterPlanned,
  batchCommandFor,
  batchKeptAfterFailure,
  isPlannedListCapped,
  type BatchCommand,
  mergePairs,
  plannedOrderText,
  type MergePair,
} from '../waybill-issue-model';

export default function WaybillIssueTemplate() {
  const { data: warehouses = [] } = useWarehouses();
  const [pickedWarehouse, setPickedWarehouse] = useState('');
  const warehouseId = pickedWarehouse || defaultWarehouseId(warehouses);
  const shipmentRead = useCan(['fulfillment.shipment.read']);
  const canRead = shipmentRead.status === 'ready' && shipmentRead.allowed;
  const shipmentDenied =
    shipmentRead.status === 'ready' && !shipmentRead.allowed;
  const planned = usePlannedShipments(canRead ? warehouseId : '');
  const board = useConsolidationBoard(canRead ? warehouseId : '');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [carrier, setCarrier] = useState<CarrierCode>('HANJIN');
  const [results, setResults] = useState<BatchResultItem[]>([]);
  const [dismissed, setDismissed] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sheetShipmentId, setSheetShipmentId] = useState('');
  const batch = useBatchIssueWaybills();

  const plannedShipments = useMemo(() => planned.data ?? [], [planned.data]);
  const visibleShipments = useMemo(
    () => filterPlanned(plannedShipments, search),
    [plannedShipments, search]
  );
  const listedIds = new Set(plannedShipments.map((s) => s.shipmentId));
  const selectedIds = Object.entries(selected)
    .filter(([id, v]) => v && listedIds.has(id))
    .map(([id]) => id);
  const pendingCommand = useRef<BatchCommand | null>(null);
  const pairs = board.isError
    ? []
    : mergePairs(selectedIds, board.data?.groups ?? [], plannedShipments);
  const pairsSignature = pairs
    .map((pair) => `${pair.key}:${pair.shipmentIds.join(',')}`)
    .join('|');
  const shownPairs = pairsSignature === dismissed ? [] : pairs;
  const partnerLabels = new Map<string, string[]>();

  for (const pair of pairs) {
    pair.shipmentIds.forEach((shipmentId, index) => {
      partnerLabels.set(
        shipmentId,
        pair.labels.filter((_, other) => other !== index)
      );
    });
  }

  const toggle = (shipmentId: string, checked: boolean) => {
    if (checked && selectedIds.length >= BATCH_ISSUE_LIMIT) {
      toast.error(`한 번에 ${BATCH_ISSUE_LIMIT}건까지만 고를 수 있어요.`);

      return;
    }

    setSelected((prev) => ({ ...prev, [shipmentId]: checked }));
  };

  const askConfirm = () => {
    if (!selectedIds.length) {
      toast.error('발급할 shipment 를 선택하세요.');

      return;
    }

    if (!isCarrierSupported(carrier)) {
      toast.error('현재 지원되는 택배사는 HANJIN 뿐입니다.');

      return;
    }

    setConfirmOpen(true);
  };

  const dismissWarning = () => {
    setDismissed(pairsSignature);
    askConfirm();
  };

  const startMerge = (pair: MergePair) =>
    setSheetShipmentId(pair.shipmentIds[0]);

  const runBatch = async () => {
    setConfirmOpen(false);

    const command = batchCommandFor(
      pendingCommand.current,
      selectedIds,
      carrier,
      () => createIdempotentCommand({}).idempotencyKey
    );

    pendingCommand.current = command;

    try {
      const res = await batch.mutateAsync({
        data: command.data,
        idempotencyKey: command.idempotencyKey,
      });

      pendingCommand.current = null;
      setResults(res);
      const issued = res.filter((r) => isWaybillIssued(r.status)).length;
      const waiting = res.filter((r) =>
        isWaybillWaitingRetry(r.status, r.nextAttemptAt)
      ).length;
      const pending =
        res.filter((r) => isWaybillPendingIssue(r.status)).length - waiting;
      const failed = res.filter((r) => isWaybillFailed(r.status)).length;
      const summary = `일괄 발급 — 총 ${res.length}건 (완료 ${issued}, 진행중 ${pending}, 재시도 대기 ${waiting}, 실패 ${failed}).`;
      if (pending || waiting || failed) toast.warning(summary);
      else toast.success(summary);
      setSelected({});
      void planned.refetch();
      void board.refetch();
    } catch (error) {
      pendingCommand.current = batchKeptAfterFailure(command, error);
      toast.error(getServerDenyMessage(error, '일괄 발급 요청 실패'));
    }
  };

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-lg font-semibold">운송장 일괄 발급</h1>
        <p className="text-sm text-muted-foreground">
          창고를 고르면 발급 대기 중인 상자를 여러 건 골라 한 번에 발급해요.
        </p>
      </div>

      <MergeWarning
        pairs={shownPairs}
        onMerge={startMerge}
        onDismiss={dismissWarning}
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label className="text-sm">창고</label>
          <Select
            value={warehouseId}
            onValueChange={(value) => {
              setPickedWarehouse(value);
              setSelected({});
            }}
          >
            <SelectTrigger className="w-[220px]" aria-label="창고">
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
        <div className="space-y-1.5">
          <label className="text-sm">택배사</label>
          <Select
            value={carrier}
            onValueChange={(v) => setCarrier(v as CarrierCode)}
          >
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
        <Input
          className="w-[220px]"
          placeholder="주문번호 검색"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Can run={useBatchIssueWaybills}>
          <Button
            onClick={askConfirm}
            disabled={batch.isPending || !selectedIds.length}
          >
            {batch.isPending
              ? '발급 중...'
              : `선택 ${selectedIds.length}건 일괄발급`}
          </Button>
        </Can>
      </div>

      {isPlannedListCapped(plannedShipments.length) && (
        <p className="text-sm text-muted-foreground">
          발급 대기 상자가 많아 먼저 {PLANNED_LIST_LIMIT}건만 보여요. 발급하면
          다음 상자가 보여요.
        </p>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>shipment</TableHead>
              <TableHead>주문</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="text-right">수량</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleShipments.map((s) => (
              <TableRow key={s.shipmentId}>
                <TableCell>
                  <Checkbox
                    checked={!!selected[s.shipmentId]}
                    onCheckedChange={(c) => toggle(s.shipmentId, c === true)}
                  />
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {s.shipmentId.slice(0, 8)}…
                </TableCell>
                <TableCell className="tabular-nums">
                  {plannedOrderText(s)}
                  {partnerLabels.has(s.shipmentId) && (
                    <Badge
                      variant="outline"
                      className="ml-2 border-blue-300 bg-blue-50"
                    >
                      {partnerLabels.get(s.shipmentId)?.join(', ')} 상자와 합칠
                      수 있어요
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">planned</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.totalQty}
                </TableCell>
              </TableRow>
            ))}
            {shipmentDenied && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-6 text-center text-sm text-muted-foreground"
                >
                  shipment 목록은 {permissionLabel('fulfillment.shipment.read')}{' '}
                  권한이 있어야 보여요.
                </TableCell>
              </TableRow>
            )}
            {canRead && warehouseId && visibleShipments.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-6 text-center text-sm text-muted-foreground"
                >
                  발급 대기 중인 상자가 없어요.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>송장 {selectedIds.length}건을 발급할까요?</DialogTitle>
            <DialogDescription>
              {carrier} 로 {selectedIds.length}건을 한 번에 발급해요. 한 번에
              최대 {BATCH_ISSUE_LIMIT}건까지 발급할 수 있어요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              취소
            </Button>
            <Button onClick={() => void runBatch()}>발급</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {sheetShipmentId && (
        <ConsolidationSheet
          shipmentId={sheetShipmentId}
          open
          onOpenChange={(open) => {
            if (!open) {
              setSheetShipmentId('');
            }
          }}
          onRequested={() => {
            void planned.refetch();
            void board.refetch();
          }}
        />
      )}

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
                    <TableCell className="font-mono text-xs">
                      {r.shipmentId}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === 'failed'
                            ? 'destructive'
                            : isWaybillWaitingRetry(r.status, r.nextAttemptAt)
                              ? 'secondary'
                              : 'outline'
                        }
                      >
                        {isWaybillWaitingRetry(r.status, r.nextAttemptAt)
                          ? '재시도 대기'
                          : r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.trackingNo ?? '-'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {retryNoticeOf(r.status, r.nextAttemptAt) ??
                        r.reason ??
                        '-'}
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
