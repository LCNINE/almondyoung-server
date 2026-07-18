'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { usePermission } from '@/hooks/use-permission';
import {
  useCancelShipmentOutstanding,
  canRecallShipment,
  createIdempotentCommand,
  FULFILLMENT_SCOPES,
  getServerDenyMessage,
  isRecoverableOperation,
  useFulfillmentOperation,
  usePlanShipment,
  useRecallShipment,
  useReviseShipmentRecipient,
  useSplitShipment,
} from '@/lib/services/orders';
import type {
  FulfillmentOperationStatus,
  ShipmentAdminDetail,
} from '@/lib/types/dto/fulfillment';

type Action = 'split' | 'recipient' | 'plan' | 'cancel' | 'recall';

type RetryState = {
  operationId: string;
  status: FulfillmentOperationStatus;
  actionLabel: string;
  idempotencyKey: string;
  run: () => Promise<void>;
};

type Recipient = {
  recipientName: string;
  phone: string;
  postalCode: string;
  roadAddress: string;
  detailAddress: string;
  deliveryNote: string;
};

const ACTION_TITLE: Record<Action, string> = {
  split: 'shipment 분할',
  recipient: '수령인 변경',
  plan: 'shipment 계획 확정',
  cancel: '미처리 수량 취소',
  recall: '출고 recall',
};

const RECALL_REASONS = [
  ['carrier_handoff_failed', '택배사 인계 실패'],
  ['dispatch_mistake', '출고 오류'],
  ['address_correction', '주소 수정'],
  ['package_recovered', '패키지 회수'],
] as const;

function blankRecipient(snapshot: unknown): Recipient {
  const value =
    snapshot && typeof snapshot === 'object'
      ? (snapshot as Partial<Recipient>)
      : {};
  return {
    recipientName: value.recipientName ?? '',
    phone: value.phone ?? '',
    postalCode: value.postalCode ?? '',
    roadAddress: value.roadAddress ?? '',
    detailAddress: value.detailAddress ?? '',
    deliveryNote: value.deliveryNote ?? '',
  };
}

function shortId(value: string) {
  return value ? `${value.slice(0, 8)}…` : '응답 대기';
}

export function ShipmentActions({
  shipment,
}: {
  shipment: ShipmentAdminDetail;
}) {
  const { hasScope, isPermissionLoading } = usePermission();
  const split = useSplitShipment();
  const reviseRecipient = useReviseShipmentRecipient();
  const plan = usePlanShipment();
  const cancel = useCancelShipmentOutstanding();
  const recall = useRecallShipment();
  const [action, setAction] = useState<Action | null>(null);
  const [lineId, setLineId] = useState(shipment.lines[0]?.id ?? '');
  const [qty, setQty] = useState('1');
  const [shippingProfileId, setShippingProfileId] = useState(
    shipment.shippingProfileId ?? ''
  );
  const [reason, setReason] = useState('');
  const [csCaseId, setCsCaseId] = useState('');
  const [note, setNote] = useState('');
  const [recipient, setRecipient] = useState<Recipient>(() =>
    blankRecipient(shipment.recipientSnapshot)
  );
  const [attemptId, setAttemptId] = useState('');
  const [recallReason, setRecallReason] =
    useState<(typeof RECALL_REASONS)[number][0]>('package_recovered');
  const [physicalRecovery, setPhysicalRecovery] = useState(false);
  const [retry, setRetry] = useState<RetryState | null>(null);
  const operation = useFulfillmentOperation(retry?.operationId ?? '');

  const line = shipment.lines.find((entry) => entry.id === lineId);
  const dispatchedAttempts = useMemo(
    () =>
      shipment.dispatchAttempts.filter(
        (attempt) => attempt.status === 'dispatched'
      ),
    [shipment.dispatchAttempts]
  );
  const status = operation.data?.status ?? retry?.status;
  const pending =
    split.isPending ||
    reviseRecipient.isPending ||
    plan.isPending ||
    cancel.isPending ||
    recall.isPending;

  const operate =
    !isPermissionLoading && !!hasScope([FULFILLMENT_SCOPES.operate]);
  const overrideRecipient =
    !isPermissionLoading && !!hasScope([FULFILLMENT_SCOPES.overrideRecipient]);
  const canRecall =
    !isPermissionLoading &&
    !!hasScope([FULFILLMENT_SCOPES.recall]) &&
    canRecallShipment(
      shipment.status,
      shipment.dispatchAttempts.map((attempt) => attempt.status)
    );

  const registerResult = (
    result: {
      operationId: string;
      operationStatus?: FulfillmentOperationStatus;
      status?: FulfillmentOperationStatus;
    },
    idempotencyKey: string,
    actionLabel: string,
    run: () => Promise<void>
  ) => {
    const nextStatus = result.operationStatus ?? result.status ?? 'pending';
    setRetry({
      operationId: result.operationId,
      status: nextStatus,
      actionLabel,
      idempotencyKey,
      run,
    });
    setAction(null);
    if (nextStatus === 'completed' || nextStatus === 'succeeded') {
      toast.success(`${actionLabel} 작업이 완료되었습니다.`);
    } else {
      toast.info(
        `${actionLabel} 작업이 접수되었습니다. 서버 완료 확인 전에는 성공으로 표시하지 않습니다.`
      );
    }
  };

  const registerPending = (
    idempotencyKey: string,
    actionLabel: string,
    run: () => Promise<void>
  ) => {
    setRetry({
      operationId: '',
      status: 'pending',
      actionLabel,
      idempotencyKey,
      run,
    });
  };

  const submit = async (originalKey?: string) => {
    if (!action) return;
    const idempotencyKey = createIdempotentCommand(
      {},
      originalKey
    ).idempotencyKey;
    const quantity = Number(qty);
    try {
      if (action === 'split') {
        if (
          !line ||
          !Number.isInteger(quantity) ||
          quantity < 1 ||
          quantity >= line.qty
        ) {
          toast.error(
            '분할 수량은 1 이상이며 원본 라인 수량보다 작아야 합니다.'
          );
          return;
        }
        if (!reason.trim()) {
          toast.error('작업 사유를 입력하세요.');
          return;
        }
        const data = {
          expectedManifestVersion: shipment.manifestVersion,
          moves: [
            {
              shipmentLineId: line.id,
              expectedLineVersion: line.lineVersion,
              qty: quantity,
            },
          ],
          reason: reason.trim(),
          ...(csCaseId.trim() ? { csCaseId: csCaseId.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        };
        const run: () => Promise<void> = async () => {
          registerPending(idempotencyKey, ACTION_TITLE[action], run);
          const result = await split.mutateAsync({
            shipmentId: shipment.id,
            data,
            idempotencyKey,
          });
          registerResult(result, idempotencyKey, ACTION_TITLE[action], run);
        };
        await run();
        return;
      }
      if (action === 'recipient') {
        if (
          !reason.trim() ||
          Object.entries(recipient).some(
            ([key, value]) => key !== 'deliveryNote' && !value.trim()
          )
        ) {
          toast.error('수령인 필수 정보와 변경 사유를 모두 입력하세요.');
          return;
        }
        const data = {
          expectedManifestVersion: shipment.manifestVersion,
          recipientSnapshot: {
            ...recipient,
            ...(recipient.deliveryNote ? {} : { deliveryNote: undefined }),
          },
          reason: reason.trim(),
          ...(csCaseId.trim() ? { csCaseId: csCaseId.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        };
        const run: () => Promise<void> = async () => {
          registerPending(idempotencyKey, ACTION_TITLE[action], run);
          const result = await reviseRecipient.mutateAsync({
            shipmentId: shipment.id,
            data,
            idempotencyKey,
          });
          registerResult(result, idempotencyKey, ACTION_TITLE[action], run);
        };
        await run();
        return;
      }
      if (action === 'plan') {
        if (!shippingProfileId.trim()) {
          toast.error('shipping profile UUID를 입력하세요.');
          return;
        }
        const data = {
          shippingProfileId: shippingProfileId.trim(),
          expectedManifestVersion: shipment.manifestVersion,
          expectedReservationVersion: shipment.reservationVersion,
        };
        const run: () => Promise<void> = async () => {
          registerPending(idempotencyKey, ACTION_TITLE[action], run);
          const result = await plan.mutateAsync({
            shipmentId: shipment.id,
            data,
            idempotencyKey,
          });
          registerResult(result, idempotencyKey, ACTION_TITLE[action], run);
        };
        await run();
        return;
      }
      if (action === 'cancel') {
        if (
          !line ||
          !Number.isInteger(quantity) ||
          quantity < 1 ||
          quantity > line.qty ||
          !reason.trim()
        ) {
          toast.error('취소 수량과 사유를 확인하세요.');
          return;
        }
        const data = {
          expectedManifestVersion: shipment.manifestVersion,
          lines: [
            {
              shipmentLineId: line.id,
              expectedLineVersion: line.lineVersion,
              qty: quantity,
            },
          ],
          reason: reason.trim(),
          ...(csCaseId.trim() ? { csCaseId: csCaseId.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        };
        const run: () => Promise<void> = async () => {
          registerPending(idempotencyKey, ACTION_TITLE[action], run);
          const result = await cancel.mutateAsync({
            shipmentId: shipment.id,
            data,
            idempotencyKey,
          });
          registerResult(result, idempotencyKey, ACTION_TITLE[action], run);
        };
        await run();
        return;
      }
      if (!attemptId || !physicalRecovery) {
        toast.error(
          '회수된 정확한 출고 시도를 선택하고 실물 회수를 확인하세요.'
        );
        return;
      }
      const data = {
        dispatchAttemptId: attemptId,
        expectedManifestVersion: shipment.manifestVersion,
        physicalRecoveryConfirmed: true as const,
        reason: recallReason,
        ...(csCaseId.trim() ? { csCaseId: csCaseId.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      };
      const run: () => Promise<void> = async () => {
        registerPending(idempotencyKey, ACTION_TITLE[action], run);
        const result = await recall.mutateAsync({
          shipmentId: shipment.id,
          data,
          idempotencyKey,
        });
        registerResult(result, idempotencyKey, ACTION_TITLE[action], run);
      };
      await run();
    } catch (error) {
      toast.error(
        getServerDenyMessage(
          error,
          `${ACTION_TITLE[action]} 요청에 실패했습니다.`
        )
      );
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {operate && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAction('split')}
          >
            분할
          </Button>
        )}
        {overrideRecipient && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAction('recipient')}
          >
            수령인 변경
          </Button>
        )}
        {operate && (
          <Button size="sm" variant="outline" onClick={() => setAction('plan')}>
            계획 확정
          </Button>
        )}
        {operate && (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setAction('cancel')}
          >
            미처리 취소
          </Button>
        )}
        {canRecall && (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setAction('recall')}
          >
            출고 recall
          </Button>
        )}
      </div>

      {retry && isRecoverableOperation(status) && (
        <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <RefreshCw />
          <AlertTitle>
            {retry.actionLabel} · {status}
          </AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {retry.operationId
                ? `작업 ${shortId(retry.operationId)}. 서버 operation 상태만 표시합니다.`
                : '서버 응답을 확인하지 못했습니다. 성공을 추정하지 않고 원래 요청 키를 보존했습니다.'}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={retry.run}
              disabled={pending}
            >
              동일 키로 안전 재시도
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Dialog open={!!action} onOpenChange={(open) => !open && setAction(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{action ? ACTION_TITLE[action] : ''}</DialogTitle>
          </DialogHeader>

          {(action === 'split' || action === 'cancel') && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>shipment line</Label>
                <Select value={lineId} onValueChange={setLineId}>
                  <SelectTrigger>
                    <SelectValue placeholder="라인 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {shipment.lines.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {shortId(entry.id)} · {entry.qty}개 · line v
                        {entry.lineVersion}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>수량</Label>
                <Input
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(event) => setQty(event.target.value)}
                />
              </div>
            </div>
          )}

          {action === 'recipient' && (
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ['recipientName', '수령인'],
                  ['phone', '전화번호'],
                  ['postalCode', '우편번호'],
                  ['roadAddress', '도로명 주소'],
                  ['detailAddress', '상세 주소'],
                  ['deliveryNote', '배송 메모'],
                ] as const
              ).map(([key, label]) => (
                <div
                  key={key}
                  className={`space-y-1.5 ${key.includes('Address') ? 'col-span-2' : ''}`}
                >
                  <Label>{label}</Label>
                  <Input
                    value={recipient[key]}
                    onChange={(event) =>
                      setRecipient({ ...recipient, [key]: event.target.value })
                    }
                  />
                </div>
              ))}
            </div>
          )}

          {action === 'plan' && (
            <div className="space-y-1.5">
              <Label>shipping profile UUID</Label>
              <Input
                value={shippingProfileId}
                onChange={(event) => setShippingProfileId(event.target.value)}
              />
            </div>
          )}

          {action === 'recall' && (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertDescription>
                  고객 반품이 아닙니다. 정확한 출고 패키지가 창고 custody로
                  돌아온 경우에만 실행하세요.
                </AlertDescription>
              </Alert>
              <div className="space-y-1.5">
                <Label>출고 시도</Label>
                <Select value={attemptId} onValueChange={setAttemptId}>
                  <SelectTrigger>
                    <SelectValue placeholder="회수한 attempt 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {dispatchedAttempts.map((attempt) => (
                      <SelectItem key={attempt.id} value={attempt.id}>
                        시도 #{attempt.attemptNo} · {shortId(attempt.id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>recall 사유</Label>
                <Select
                  value={recallReason}
                  onValueChange={(value) =>
                    setRecallReason(value as typeof recallReason)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RECALL_REASONS.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
                <Checkbox
                  checked={physicalRecovery}
                  onCheckedChange={(checked) =>
                    setPhysicalRecovery(checked === true)
                  }
                />
                <span>
                  선택한 출고 시도의 실물 패키지가 창고에 회수되었음을
                  확인합니다.
                </span>
              </label>
            </div>
          )}

          {action !== 'plan' && action !== 'recall' && (
            <div className="space-y-1.5">
              <Label>작업 사유 (필수)</Label>
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          )}
          {action !== 'plan' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>CS case UUID</Label>
                <Input
                  value={csCaseId}
                  onChange={(event) => setCsCaseId(event.target.value)}
                  placeholder="선택"
                />
              </div>
              <div className="space-y-1.5">
                <Label>운영 메모</Label>
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={2}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>
              취소
            </Button>
            <Button
              variant={
                action === 'cancel' || action === 'recall'
                  ? 'destructive'
                  : 'default'
              }
              onClick={() => submit()}
              disabled={
                pending ||
                (action === 'recall' && (!attemptId || !physicalRecovery))
              }
            >
              {pending ? '요청 중...' : '서버에 요청'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
