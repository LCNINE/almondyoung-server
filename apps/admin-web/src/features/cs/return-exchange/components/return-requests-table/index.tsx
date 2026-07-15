'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useReturnRequests,
  useApproveReturn,
  useRejectReturn,
  useMarkReturnCollectionPending,
  useMarkReturnCollected,
  useMarkReturnInspected,
  useCompleteReturn,
  useRetryReturnRefund,
  useManualCompleteReturn,
  useCreateReturnRequest,
} from '@/lib/services/return-exchange';
import { getServerDenyMessage } from '@/lib/services/orders';
import { FULFILLMENT_SCOPES } from '@/lib/services/orders/operation-policy';
import { useReturnEligibility } from '@/lib/services/return-exchange';
import { usePermission } from '@/hooks/use-permission';
import type { ReturnRequest } from '@/lib/api/domains/return-exchange';
import {
  isReturnAttemptSelectable,
  maxReturnAttemptSelectableQty,
  summarizeReturnAttemptIdentity,
} from '../../return-attempt-view-model';

const STATUS_LABELS: Record<ReturnRequest['status'], string> = {
  requested: '신청',
  approved: '승인',
  rejected: '거절',
  collection_pending: '수거 대기',
  collected: '수거 완료',
  inspected: '검수 완료',
  refund_pending: '환불 대기',
  completed: '완료',
  cancelled: '취소',
};

const STATUS_VARIANTS: Record<
  ReturnRequest['status'],
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  requested: 'default',
  approved: 'secondary',
  rejected: 'destructive',
  collection_pending: 'secondary',
  collected: 'secondary',
  inspected: 'secondary',
  refund_pending: 'outline',
  completed: 'outline',
  cancelled: 'destructive',
};

interface Props {
  statusFilter?: string;
  page: number;
  onPageChange: (p: number) => void;
}

const PAGE_SIZE = 20;

export function ReturnRequestsTable({
  statusFilter,
  page,
  onPageChange,
}: Props) {
  const query = { status: statusFilter, page, limit: PAGE_SIZE };
  const { data, isLoading, isFetching } = useReturnRequests(query);
  const { hasScope, isPermissionLoading } = usePermission();
  const canReadEligibility =
    !isPermissionLoading && hasScope([FULFILLMENT_SCOPES.operate]) === true;

  const approve = useApproveReturn();
  const reject = useRejectReturn();
  const pending = useMarkReturnCollectionPending();
  const collected = useMarkReturnCollected();
  const inspected = useMarkReturnInspected();
  const complete = useCompleteReturn();
  const retryRefund = useRetryReturnRefund();
  const manualComplete = useManualCompleteReturn();
  const createReturn = useCreateReturnRequest();

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [manualCompleteTarget, setManualCompleteTarget] = useState<
    string | null
  >(null);
  const [manualCompleteNote, setManualCompleteNote] = useState('');
  const [eligibilityOrderInput, setEligibilityOrderInput] = useState('');
  const [eligibilityOrderId, setEligibilityOrderId] = useState('');
  const [selectedEligibilityKey, setSelectedEligibilityKey] = useState('');
  const [selectedEligibilityQty, setSelectedEligibilityQty] = useState('1');
  const [returnReasonCode, setReturnReasonCode] = useState<
    | 'defective'
    | 'not_as_described'
    | 'change_of_mind'
    | 'wrong_item'
    | 'damaged_in_shipping'
    | 'other'
  >('other');
  const [returnReasonDetail, setReturnReasonDetail] = useState('');
  const eligibility = useReturnEligibility(eligibilityOrderId);
  const selectedEligibilityItem = eligibility.data?.items.find(
    (item) =>
      `${item.shipmentLineId}:${item.dispatchAttemptId}` ===
      selectedEligibilityKey
  );
  const selectedEligibilityMax = selectedEligibilityItem
    ? maxReturnAttemptSelectableQty(selectedEligibilityItem)
    : 0;

  const act = async (fn: () => Promise<unknown>, label: string) => {
    try {
      await fn();
      toast.success(`${label} 처리되었습니다.`);
    } catch (error) {
      toast.error(getServerDenyMessage(error, `${label} 처리에 실패했습니다.`));
    }
  };

  const handleManualComplete = async () => {
    if (!manualCompleteTarget || !manualCompleteNote.trim()) return;
    try {
      await manualComplete.mutateAsync({
        id: manualCompleteTarget,
        adminNote: manualCompleteNote.trim(),
      });
      toast.success('수동 완료 처리되었습니다.');
      setManualCompleteTarget(null);
      setManualCompleteNote('');
    } catch (error) {
      toast.error(
        getServerDenyMessage(error, '수동 완료 처리에 실패했습니다.')
      );
    }
  };

  const handleCreateReturn = async () => {
    if (!selectedEligibilityItem) return;
    const quantity = Number(selectedEligibilityQty);
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > selectedEligibilityMax
    ) {
      toast.error(
        `반품 수량은 1~${selectedEligibilityMax} 사이의 정수여야 합니다.`
      );
      return;
    }
    try {
      await createReturn.mutateAsync({
        orderId: eligibilityOrderId,
        lines: [
          {
            salesOrderLineId: selectedEligibilityItem.salesOrderLineId,
            shipmentLineId: selectedEligibilityItem.shipmentLineId,
            dispatchAttemptId: selectedEligibilityItem.dispatchAttemptId,
            quantity,
          },
        ],
        reasonCode: returnReasonCode,
        reasonDetail: returnReasonDetail.trim() || undefined,
      });
      toast.success('선택한 배송 attempt로 반품 요청을 생성했습니다.');
      setSelectedEligibilityKey('');
      setSelectedEligibilityQty('1');
      setReturnReasonDetail('');
      setEligibilityOrderId('');
    } catch (error) {
      toast.error(
        getServerDenyMessage(error, '반품 요청 생성에 실패했습니다.')
      );
    }
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-3">
      {canReadEligibility && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="space-y-1">
            <Label htmlFor="return-eligibility-order-id">판매 주문 ID</Label>
            <Input
              id="return-eligibility-order-id"
              className="w-80"
              placeholder="반품을 접수할 sales order UUID"
              value={eligibilityOrderInput}
              onChange={(event) => setEligibilityOrderInput(event.target.value)}
            />
          </div>
          <Button
            variant="outline"
            disabled={!eligibilityOrderInput.trim()}
            onClick={() => {
              setEligibilityOrderId(eligibilityOrderInput.trim());
              setSelectedEligibilityKey('');
            }}
          >
            attempt별 반품 가능 수량 조회
          </Button>
        </div>
      )}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[180px]">요청 ID</TableHead>
              <TableHead className="w-[180px]">주문 ID</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>사유</TableHead>
              <TableHead>반품 기준</TableHead>
              <TableHead>신청일</TableHead>
              <TableHead className="text-right">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground py-8"
                >
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground py-8"
                >
                  반품 요청이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              items.map(({ request, items: requestItems }) => {
                const identity = summarizeReturnAttemptIdentity(requestItems);
                return (
                  <TableRow
                    key={request.id}
                    className={isFetching ? 'opacity-60' : ''}
                  >
                    <TableCell className="font-mono text-xs">
                      {request.id.slice(0, 8)}…
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {request.salesOrderId.slice(0, 8)}…
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANTS[request.status]}>
                        {STATUS_LABELS[request.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {request.reasonCode}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        {identity.exactCount > 0 && (
                          <Badge variant="outline">
                            attempt 연결 {identity.exactCount}
                          </Badge>
                        )}
                        {identity.legacyCount > 0 && (
                          <Badge variant="destructive">
                            legacy null {identity.legacyCount}
                          </Badge>
                        )}
                        {canReadEligibility && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs"
                            onClick={() =>
                              setEligibilityOrderId(request.salesOrderId)
                            }
                          >
                            남은 수량
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(request.createdAt).toLocaleDateString('ko-KR')}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end flex-wrap">
                        {request.status === 'requested' && (
                          <>
                            <Button
                              size="sm"
                              variant="default"
                              disabled={
                                approve.isPending && confirmingId === request.id
                              }
                              onClick={() => {
                                setConfirmingId(request.id);
                                act(
                                  () => approve.mutateAsync({ id: request.id }),
                                  '승인'
                                );
                              }}
                            >
                              승인
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={
                                reject.isPending && confirmingId === request.id
                              }
                              onClick={() => {
                                setConfirmingId(request.id);
                                act(
                                  () => reject.mutateAsync({ id: request.id }),
                                  '거절'
                                );
                              }}
                            >
                              거절
                            </Button>
                          </>
                        )}
                        {request.status === 'approved' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending.isPending}
                            onClick={() =>
                              act(
                                () => pending.mutateAsync(request.id),
                                '수거 대기'
                              )
                            }
                          >
                            수거 대기
                          </Button>
                        )}
                        {request.status === 'collection_pending' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={collected.isPending}
                            onClick={() =>
                              act(
                                () => collected.mutateAsync(request.id),
                                '수거 완료'
                              )
                            }
                          >
                            수거 완료
                          </Button>
                        )}
                        {request.status === 'collected' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={inspected.isPending}
                            onClick={() =>
                              act(
                                () => inspected.mutateAsync(request.id),
                                '검수 완료'
                              )
                            }
                          >
                            검수 완료
                          </Button>
                        )}
                        {request.status === 'inspected' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={complete.isPending}
                            onClick={() =>
                              act(
                                () => complete.mutateAsync(request.id),
                                '처리 완료'
                              )
                            }
                          >
                            완료 처리
                          </Button>
                        )}
                        {request.status === 'refund_pending' && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                retryRefund.isPending &&
                                confirmingId === request.id
                              }
                              onClick={() => {
                                setConfirmingId(request.id);
                                act(
                                  () => retryRefund.mutateAsync(request.id),
                                  '환불 재시도'
                                );
                              }}
                            >
                              환불 재시도
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setManualCompleteTarget(request.id);
                                setManualCompleteNote('');
                              }}
                            >
                              수동 완료
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>총 {total}건</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              이전
            </Button>
            <span className="self-center">
              {page} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              다음
            </Button>
          </div>
        </div>
      )}

      {canReadEligibility && eligibilityOrderId && (
        <div className="rounded-md border p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">
                배송 완료 attempt별 반품 가능 수량
              </p>
              <p className="font-mono text-xs text-muted-foreground">
                order {eligibilityOrderId}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEligibilityOrderId('')}
            >
              닫기
            </Button>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            정확한 shipment line + dispatch attempt가 있고 남은 수량이 1개
            이상인 행만 선택할 수 있습니다. legacy null 행은 읽기 전용이며
            선택되지 않습니다.
          </p>
          {eligibility.isLoading ? (
            <p className="text-sm text-muted-foreground">
              반품 eligibility 조회 중...
            </p>
          ) : eligibility.isError ? (
            <p className="text-sm text-destructive">
              {getServerDenyMessage(
                eligibility.error,
                '반품 가능 수량 조회에 실패했습니다.'
              )}
            </p>
          ) : (eligibility.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              반품 가능한 배송 완료 라인이 없습니다.
            </p>
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">선택</TableHead>
                    <TableHead>shipment line</TableHead>
                    <TableHead>dispatch attempt</TableHead>
                    <TableHead>배송 완료</TableHead>
                    <TableHead className="text-right">출고</TableHead>
                    <TableHead className="text-right">기신청</TableHead>
                    <TableHead className="text-right">attempt 잔여</TableHead>
                    <TableHead className="text-right">
                      주문라인 전체 잔여
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {eligibility.data?.items.map((item) => {
                    const key = `${item.shipmentLineId}:${item.dispatchAttemptId}`;
                    const selectable = isReturnAttemptSelectable(item);
                    return (
                      <TableRow key={key}>
                        <TableCell>
                          <Checkbox
                            checked={selectedEligibilityKey === key}
                            disabled={!selectable}
                            onCheckedChange={(checked) => {
                              setSelectedEligibilityKey(
                                checked === true ? key : ''
                              );
                              setSelectedEligibilityQty('1');
                            }}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {item.shipmentLineId}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {item.dispatchAttemptId}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(item.deliveredAt).toLocaleString('ko-KR')}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {item.shippedQty}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {item.claimedQty}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant={
                              item.remainingEligibleQty > 0
                                ? 'default'
                                : 'secondary'
                            }
                          >
                            {item.remainingEligibleQty}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {item.salesOrderLineRemainingEligibleQty}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {selectedEligibilityKey && (
            <div className="mt-3 space-y-3 rounded-md border bg-muted/30 p-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label>선택 반품 수량</Label>
                  <Input
                    className="w-28"
                    type="number"
                    min={1}
                    max={selectedEligibilityMax}
                    value={selectedEligibilityQty}
                    onChange={(event) =>
                      setSelectedEligibilityQty(event.target.value)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>반품 사유</Label>
                  <select
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    value={returnReasonCode}
                    onChange={(event) =>
                      setReturnReasonCode(
                        event.target.value as typeof returnReasonCode
                      )
                    }
                  >
                    <option value="defective">상품 불량</option>
                    <option value="not_as_described">설명과 다름</option>
                    <option value="change_of_mind">단순 변심</option>
                    <option value="wrong_item">오배송</option>
                    <option value="damaged_in_shipping">배송 중 파손</option>
                    <option value="other">기타</option>
                  </select>
                </div>
                <div className="min-w-64 flex-1 space-y-1">
                  <Label>상세 사유</Label>
                  <Input
                    maxLength={500}
                    value={returnReasonDetail}
                    onChange={(event) =>
                      setReturnReasonDetail(event.target.value)
                    }
                    placeholder="선택 사항"
                  />
                </div>
                <Button
                  disabled={
                    createReturn.isPending || selectedEligibilityMax < 1
                  }
                  onClick={handleCreateReturn}
                >
                  {createReturn.isPending ? '접수 중...' : '반품 요청 접수'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                이 attempt에서 한 번에 선택 가능한 최대 수량은{' '}
                {selectedEligibilityMax}개이며, legacy/다른 attempt claim을
                포함한 주문라인 전체 잔여 한도를 함께 적용합니다.
              </p>
            </div>
          )}
        </div>
      )}

      <Dialog
        open={!!manualCompleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setManualCompleteTarget(null);
            setManualCompleteNote('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>수동 환불 완료 확인</DialogTitle>
            <p className="text-sm text-muted-foreground mt-1">
              실제 환불(무통장 입금 확인 등)이 완료된 경우에만 사용하세요. 이
              작업은 되돌릴 수 없습니다.
            </p>
          </DialogHeader>
          <div className="space-y-2">
            <Label>처리 사유 (필수)</Label>
            <textarea
              className="w-full rounded-md border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              rows={3}
              placeholder="예: 무통장 입금 확인 완료 — 담당자: 홍길동"
              value={manualCompleteNote}
              onChange={(e) => setManualCompleteNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setManualCompleteTarget(null);
                setManualCompleteNote('');
              }}
              disabled={manualComplete.isPending}
            >
              취소
            </Button>
            <Button
              variant="default"
              onClick={handleManualComplete}
              disabled={manualComplete.isPending || !manualCompleteNote.trim()}
            >
              {manualComplete.isPending ? '처리 중...' : '완료 처리'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
