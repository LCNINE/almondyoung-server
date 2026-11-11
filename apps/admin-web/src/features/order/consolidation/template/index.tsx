'use client';

import { Fragment, useState } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
  ConsolidationItemList,
  MergedItemsTable,
} from '@/features/order/fulfillments/detail/consolidation-items';
import { ConsolidationOutcomeView } from '@/features/order/fulfillments/detail/consolidation-result';
import { ConsolidationSheet } from '@/features/order/fulfillments/detail/consolidation-sheet';
import {
  boxNoText,
  itemsTotalText,
  mergedItems,
  splitShareText,
  type PendingCommand,
} from '@/features/order/fulfillments/detail/consolidation-sheet-model';
import { usePermissionCheck } from '@/hooks/use-permission';
import { useWarehouses } from '@/lib/services/inventory/queries';
import {
  getServerDenyMessage,
  useConsolidationBoard,
  useCreateShipmentConsolidation,
} from '@/lib/services/orders';
import type {
  ConsolidationBoardGroup,
  ConsolidationBoardShipment,
} from '@/lib/types/dto/fulfillment';
import { cn } from '@/lib/utils/ui';
import {
  BOARD_EMPTY_TEXT,
  boardFooterText,
  boardRecipientView,
  boardRowAction,
  defaultWarehouseId,
  filterBoardGroups,
  groupOrderNos,
  isBulkSelectable,
  pickableForMerge,
  unconfirmedKeys,
  shipmentBadge,
  summarizeBulk,
  replaceResult,
  retryUnconfirmed,
  runBulkMerge,
  type BulkResult,
} from '../board-model';

const BULK_LABEL: Record<BulkResult['status'], string> = {
  done: '성공',
  failed: '실패',
  unconfirmed: '확인 필요',
};

function orderedAtText(value: string | null): string {
  if (!value) {
    return '-';
  }

  return new Date(value).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function shipmentNo(shipment: ConsolidationBoardShipment): string {
  return shipment.salesOrderNos.length === 0
    ? `상자 ${shipment.shipmentId.slice(0, 8)}`
    : shipment.salesOrderNos.map((no) => `#${no}`).join(', ');
}

export default function ConsolidationTemplate() {
  const { data: warehouses = [] } = useWarehouses();
  const { can, canRun, isPermissionLoading } = usePermissionCheck();
  const [pickedWarehouse, setPickedWarehouse] = useState('');
  const [todayOnly, setTodayOnly] = useState(false);
  const [beforeWaybillOnly, setBeforeWaybillOnly] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  // 보드에서 연 합치기는 같은 묶음의 다른 상자를 미리 골라 둔다
  const [sheet, setSheet] = useState<{
    shipmentId: string;
    preselect: string[];
  } | null>(null);
  const [results, setResults] = useState<BulkResult[]>([]);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  // 확인 창에 보여 준 묶음 그대로 요청한다. 그사이 목록을 다시 불러와도 바뀌지 않는다.
  const [confirming, setConfirming] = useState<ConsolidationBoardGroup[]>([]);

  const warehouseId = pickedWarehouse || defaultWarehouseId(warehouses);
  const canRead = can(['fulfillment.shipment.read']);
  const canCreate = canRun(useCreateShipmentConsolidation);
  const board = useConsolidationBoard(canRead ? warehouseId : '');
  const create = useCreateShipmentConsolidation();

  const groups = filterBoardGroups(
    board.data?.groups ?? [],
    { todayOnly, beforeWaybillOnly },
    new Date()
  );
  const pickedGroups = pickableForMerge(groups, selected, results);
  const held = unconfirmedKeys(results);

  const toggle = (key: string, checked: boolean) =>
    setSelected((current) =>
      checked ? [...current, key] : current.filter((value) => value !== key)
    );

  const toggleExpanded = (key: string) =>
    setExpanded((current) =>
      current.includes(key)
        ? current.filter((value) => value !== key)
        : [...current, key]
    );

  const send = (command: PendingCommand) => create.mutateAsync(command);
  const describe = (error: unknown) =>
    getServerDenyMessage(error, '합포장 요청에 실패했어요.');

  const mergeSelected = async (targets: ConsolidationBoardGroup[]) => {
    setConfirming([]);
    setRunning(true);

    const collected = await runBulkMerge(targets, warehouseId, send, describe);

    setRunning(false);
    setSelected([]);
    setResults((current) => [
      ...current.filter(
        (result) =>
          result.status === 'unconfirmed' &&
          !collected.some((next) => next.key === result.key)
      ),
      ...collected,
    ]);
    setResultsOpen(true);

    if (collected.some((result) => result.status === 'done')) {
      toast.success('선택한 주문의 합포장을 마쳤어요.');
    }

    await board.refetch();
  };

  const recheck = async (result: BulkResult) => {
    setRunning(true);

    const next = await retryUnconfirmed(result, send, describe);

    setRunning(false);
    setResults((current) => replaceResult(current, next));
    await board.refetch();
  };

  const unconfirmedCount = results.filter(
    (result) => result.status === 'unconfirmed'
  ).length;

  return (
    <Container>
      <Header
        title="합칠 수 있는 주문"
        subtitle="같은 고객, 같은 주소로 가는 주문이에요. 고른 주문은 새 상자 하나, 송장 한 장으로 나가요."
      />
      <div className="flex flex-col gap-4 p-4">
        {unconfirmedCount > 0 && (
          <Alert>
            <AlertTriangle />
            <AlertTitle>
              확인이 필요한 합포장이 {unconfirmedCount}건 있어요
            </AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>응답을 받지 못해서 서버가 처리했는지 알 수 없어요.</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setResultsOpen(true)}
              >
                결과 보기
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {!isPermissionLoading && !canRead && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>조회 권한 없음</AlertTitle>
            <AlertDescription>
              합칠 수 있는 주문을 볼 권한이 없어요.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={warehouseId}
              onValueChange={(value) => {
                setPickedWarehouse(value);
                setSelected([]);
              }}
              disabled={!canRead}
            >
              <SelectTrigger className="w-48" aria-label="창고">
                <SelectValue placeholder="창고 선택" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={warehouse.id}>
                    창고: {warehouse.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={todayOnly ? 'secondary' : 'outline'}
              aria-pressed={todayOnly}
              onClick={() => setTodayOnly((value) => !value)}
            >
              주문일: 오늘
            </Button>
            <Button
              variant={beforeWaybillOnly ? 'secondary' : 'outline'}
              aria-pressed={beforeWaybillOnly}
              onClick={() => setBeforeWaybillOnly((value) => !value)}
            >
              송장 전 주문만
            </Button>
          </div>
          {canCreate && (
            <Button
              onClick={() => setConfirming(pickedGroups)}
              disabled={running || pickedGroups.length === 0}
            >
              {running ? '합치는 중...' : '선택 항목 합치기'}
            </Button>
          )}
        </div>

        {!warehouseId ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            창고를 선택해 주세요.
          </p>
        ) : board.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            합칠 수 있는 주문을 불러오고 있어요.
          </p>
        ) : board.isError ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription>
              {getServerDenyMessage(
                board.error,
                '합칠 수 있는 주문을 불러오지 못했어요.'
              )}
            </AlertDescription>
          </Alert>
        ) : groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {BOARD_EMPTY_TEXT}
          </p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>주문번호</TableHead>
                  <TableHead>주문시각</TableHead>
                  <TableHead>합칠 상품</TableHead>
                  <TableHead>받는 분</TableHead>
                  <TableHead>배송지</TableHead>
                  <TableHead>송장번호</TableHead>
                  <TableHead>합칠 수 있는지</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group, index) => (
                  <GroupRows
                    key={group.key}
                    group={group}
                    striped={index % 2 === 1}
                    canCreate={canCreate}
                    held={held.has(group.key)}
                    checked={selected.includes(group.key)}
                    onCheck={(checked) => toggle(group.key, checked)}
                    expanded={expanded.includes(group.key)}
                    onToggleExpanded={() => toggleExpanded(group.key)}
                    onOpen={() =>
                      setSheet({
                        shipmentId: group.shipments[0].shipmentId,
                        preselect: group.shipments
                          .slice(1)
                          .map((shipment) => shipment.shipmentId),
                      })
                    }
                  />
                ))}
              </TableBody>
            </Table>
            <div className="border-t px-4 py-3 text-sm">
              <span>{boardFooterText(groups)}</span>
            </div>
          </div>
        )}
      </div>

      {sheet && (
        <ConsolidationSheet
          shipmentId={sheet.shipmentId}
          preselect={sheet.preselect}
          warehouseId={warehouseId}
          open
          onOpenChange={(open) => {
            if (!open) {
              setSheet(null);
            }
          }}
          onRequested={() => {
            board.refetch();
          }}
        />
      )}

      <Dialog
        open={confirming.length > 0}
        onOpenChange={(open) => {
          if (!open) {
            setConfirming([]);
          }
        }}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>선택한 주문 합치기</DialogTitle>
            <DialogDescription>
              묶음마다 새 상자 하나, 송장 한 장으로 나가요. 요청하면 취소할 수
              없어요.
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            {confirming.map((group) => {
              const merged = mergedItems(group.shipments);

              return (
                <section key={group.key} className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">
                    {groupOrderNos(group)} → 상자 1개
                  </h3>
                  {merged ? <MergedItemsTable items={merged} /> : null}
                </section>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming([])}>
              취소
            </Button>
            <Button
              onClick={() => mergeSelected(confirming)}
              disabled={running}
            >
              {confirming.length}묶음 합치기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resultsOpen} onOpenChange={setResultsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>합치기 결과</DialogTitle>
            <DialogDescription>{summarizeBulk(results)}</DialogDescription>
          </DialogHeader>
          <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto text-sm">
            {results.map((result) => (
              <li
                key={result.key}
                aria-label={`${result.orderNos} 결과`}
                className="flex flex-col gap-2 rounded-md border p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium">{result.orderNos}</span>
                  <span className="text-right">
                    <Badge variant="outline">{BULK_LABEL[result.status]}</Badge>
                    <span className="mt-1 block text-muted-foreground">
                      {result.message}
                    </span>
                    {result.status === 'unconfirmed' && canCreate && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        disabled={running}
                        onClick={() => recheck(result)}
                      >
                        다시 확인
                      </Button>
                    )}
                  </span>
                </div>
                {result.outcome ? (
                  <ConsolidationOutcomeView outcome={result.outcome} />
                ) : null}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </Container>
  );
}

function GroupRows({
  group,
  striped,
  canCreate,
  held,
  checked,
  onCheck,
  expanded,
  onToggleExpanded,
  onOpen,
}: {
  group: ConsolidationBoardGroup;
  striped: boolean;
  canCreate: boolean;
  held: boolean;
  checked: boolean;
  onCheck: (checked: boolean) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpen: () => void;
}) {
  const span = group.shipments.length;
  const recipient = boardRecipientView(group.recipientSnapshot);
  const action = boardRowAction(group);
  const selectable = isBulkSelectable(group);
  const rowClass = cn(striped && 'bg-muted/40');
  const merged = mergedItems(group.shipments);

  return (
    <Fragment>
      {group.shipments.map((shipment, index) => {
        const badge = shipmentBadge(shipment);

        return (
          <TableRow key={shipment.shipmentId} className={rowClass}>
            {index === 0 && (
              <TableCell rowSpan={span}>
                <Checkbox
                  checked={checked}
                  disabled={!selectable || !canCreate || held}
                  onCheckedChange={(value) => onCheck(value === true)}
                  aria-label={`${groupOrderNos(group)} 선택`}
                />
              </TableCell>
            )}
            <TableCell>
              <span className="font-semibold">{shipmentNo(shipment)}</span>{' '}
              <span className="text-xs text-muted-foreground">
                {shipment.salesChannels.join(', ')}
              </span>
              {shipment.split && (
                <div className="text-xs font-medium text-foreground">
                  {splitShareText(shipment.split)}
                </div>
              )}
              {expanded && shipment.items ? (
                <ConsolidationItemList
                  label={`주문 ${boxNoText(shipment)} 상품`}
                  items={shipment.items}
                  className="mt-1 max-w-64 text-xs"
                />
              ) : null}
            </TableCell>
            <TableCell className="text-xs">
              {orderedAtText(shipment.orderedAt)}
            </TableCell>
            {index === 0 && (
              <TableCell rowSpan={span}>
                {merged ? (
                  <>
                    <div className="font-medium">{itemsTotalText(merged)}</div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-2 h-7 px-2 text-xs"
                      aria-expanded={expanded}
                      aria-label={`${groupOrderNos(group)} 주문별 상품 보기`}
                      onClick={onToggleExpanded}
                    >
                      주문별 상품
                      <ChevronDown
                        className={cn(
                          'size-3.5 transition-transform',
                          expanded && 'rotate-180'
                        )}
                      />
                    </Button>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">-</span>
                )}
              </TableCell>
            )}
            {index === 0 && (
              <>
                <TableCell rowSpan={span}>
                  {recipient.name}
                  <div className="text-xs text-muted-foreground">
                    전화번호 같음
                  </div>
                </TableCell>
                <TableCell
                  rowSpan={span}
                  className="min-w-40 whitespace-normal"
                >
                  {recipient.address}
                  <div className="text-xs text-muted-foreground">
                    {recipient.addressNote}
                  </div>
                  {group.memoDiffers && (
                    <div className="text-xs text-muted-foreground">
                      배송 메모가 서로 달라요
                    </div>
                  )}
                </TableCell>
              </>
            )}
            <TableCell className="text-xs">
              {shipment.waybillTrackingNo ?? (
                <span className="text-muted-foreground">없음</span>
              )}
            </TableCell>
            <TableCell>
              <Badge
                variant="outline"
                className={cn(
                  'text-neutral-800',
                  badge.tone === 'ok'
                    ? 'border-green-300 bg-green-50'
                    : 'border-amber-300 bg-amber-50'
                )}
              >
                {badge.label}
              </Badge>
            </TableCell>
            {index === 0 && (
              <TableCell rowSpan={span}>
                {canCreate && (
                  <Button
                    size="sm"
                    variant={action === 'merge' ? 'default' : 'outline'}
                    onClick={onOpen}
                  >
                    {action === 'merge' ? '합치기' : '되돌리고 합치기'}
                  </Button>
                )}
              </TableCell>
            )}
          </TableRow>
        );
      })}
    </Fragment>
  );
}
