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
import { usePermissionCheck } from '@/hooks/use-permission';
import { useDeliveryProfiles } from '@/lib/services/inventory/queries';
import {
  SPLIT_QTY_ERROR,
  isSplitQtyAllowed,
} from '@/lib/api/domains/orders/order-progress.shape';
import {
  canRecallShipment,
  createIdempotentCommand,
  getServerDenyMessage,
  isRecoverableOperation,
  parseServerError,
  useCreateShipmentConsolidation,
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
import {
  buildRecipientRevisionPayload,
  missingRecipientFields,
  RECIPIENT_FIELDS,
  type RecipientForm,
} from './recipient-revision';
import { ConsolidationSheet } from './consolidation-sheet';
import { showsConsolidationButton } from './consolidation-sheet-model';
import {
  ACTION_TITLE,
  SUBMIT_LABEL,
  dispatchAttemptLabel,
  operationStatusLabel,
  retryNotice,
} from './shipment-action-copy';
import {
  splitLineLabel,
  splitLineName,
  splitPreview,
} from './shipment-split-model';
import {
  recallConfirmText,
  shipmentActionsFor,
  type ShipmentAction,
} from './shipment-owner';

type Action = ShipmentAction;

const RECALL_REASONS = [
  ['carrier_handoff_failed', '택배사 인계 실패'],
  ['dispatch_mistake', '출고 오류'],
  ['address_correction', '주소 수정'],
  ['package_recovered', '상자 회수'],
] as const;

type RecallReason = (typeof RECALL_REASONS)[number][0];

// 창에 입력한 값. 작업 기록에 남으므로 새 작업을 열 때마다 비운다.
// 같은 화면이 다른 상자로 바뀔 수 있어 어느 상자의 입력인지 함께 둔다.
type ActionDraft = {
  shipmentId: string;
  lineId: string;
  qty: string;
  shippingProfileId: string;
  reason: string;
  note: string;
  recipient: RecipientForm;
  attemptId: string;
  recallReason: RecallReason;
  physicalRecovery: boolean;
};

type RetryState = {
  action: Action;
  operationId: string;
  status: FulfillmentOperationStatus;
  actionLabel: string;
  idempotencyKey: string;
  // 서버가 거절하면 이 입력으로 창을 다시 연다
  draft: ActionDraft;
  run: () => Promise<void>;
};

function blankRecipient(snapshot: unknown): RecipientForm {
  const value =
    snapshot && typeof snapshot === 'object'
      ? (snapshot as Partial<RecipientForm>)
      : {};
  return {
    recipientName: value.recipientName ?? '',
    phone: value.phone ?? '',
    postalCode: value.postalCode ?? '',
    roadAddress: value.roadAddress ?? '',
    detailAddress: value.detailAddress ?? '',
    deliveryNote: value.deliveryNote ?? '',
    // 비번은 스냅샷에 없다(크리덴셜이라 응답에 실리지 않는다). 빈 값은 "안 건드림"이다.
    entrancePassword: '',
  };
}

function freshDraft(shipment: ShipmentAdminDetail): ActionDraft {
  return {
    shipmentId: shipment.id,
    lineId: shipment.lines[0]?.id ?? '',
    qty: '1',
    shippingProfileId: shipment.shippingProfileId ?? '',
    reason: '',
    note: '',
    recipient: blankRecipient(shipment.recipientSnapshot),
    attemptId: '',
    recallReason: 'package_recovered',
    physicalRecovery: false,
  };
}

export function ShipmentActions({
  shipment,
}: {
  shipment: ShipmentAdminDetail;
}) {
  const { can, canRun } = usePermissionCheck();
  const [consolidating, setConsolidating] = useState(false);
  const split = useSplitShipment();
  const reviseRecipient = useReviseShipmentRecipient();
  const plan = usePlanShipment();
  const recall = useRecallShipment();
  const [action, setAction] = useState<Action | null>(null);
  const [draft, setDraft] = useState<ActionDraft>(() => freshDraft(shipment));
  const {
    lineId,
    qty,
    shippingProfileId,
    reason,
    note,
    recipient,
    attemptId,
    recallReason,
    physicalRecovery,
  } = draft;
  const edit = <K extends keyof ActionDraft>(key: K, value: ActionDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const profiles = useDeliveryProfiles();
  // 프로필이 하나뿐이면 고를 것이 없다
  const chosenProfileId =
    shippingProfileId ||
    (profiles.data?.length === 1 ? profiles.data[0].id : '');
  const [retry, setRetry] = useState<RetryState | null>(null);
  const operation = useFulfillmentOperation(retry?.operationId ?? '');

  const line = shipment.lines.find((entry) => entry.id === lineId);
  const preview = splitPreview(line, qty, shipment.lines);
  const boxTotal = shipment.lines.reduce((sum, entry) => sum + entry.qty, 0);
  const maxMove = line ? Math.min(line.qty, boxTotal - 1) : 0;
  const lineName = line ? splitLineName(line) : '';
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
    recall.isPending;

  const allowed = shipmentActionsFor(shipment);
  const isSupplier = !!shipment.supplierId;
  const canRecall =
    allowed.includes('recall') &&
    canRun(useRecallShipment) &&
    canRecallShipment(
      shipment.status,
      shipment.dispatchAttempts.map((attempt) => attempt.status)
    );
  const canConsolidate = showsConsolidationButton(shipment, {
    canConsolidate: canRun(useCreateShipmentConsolidation),
    canReopen: can(['fulfillment.shipment.reopen']),
  });

  const registerResult = (
    result: {
      operationId: string;
      operationStatus?: FulfillmentOperationStatus;
      status?: FulfillmentOperationStatus;
    },
    idempotencyKey: string,
    done: Action,
    sent: ActionDraft,
    run: () => Promise<void>
  ) => {
    const actionLabel = ACTION_TITLE[done];
    const nextStatus = result.operationStatus ?? result.status ?? 'pending';
    setRetry({
      action: done,
      operationId: result.operationId,
      status: nextStatus,
      actionLabel,
      idempotencyKey,
      draft: sent,
      run,
    });
    setAction(null);
    if (nextStatus === 'completed' || nextStatus === 'succeeded') {
      toast.success(`${actionLabel} 완료`);
    } else {
      toast.info(
        `${actionLabel} 요청을 받았어요. 처리 상태는 상자 작업 버튼 아래에 보여요.`
      );
    }
  };

  const registerPending = (
    idempotencyKey: string,
    pendingAction: Action,
    sent: ActionDraft,
    run: () => Promise<void>
  ) => {
    setRetry({
      action: pendingAction,
      operationId: '',
      status: 'pending',
      actionLabel: ACTION_TITLE[pendingAction],
      idempotencyKey,
      draft: sent,
      run,
    });
  };

  const handleFailure = (
    error: unknown,
    failed: Action,
    sent: ActionDraft
  ) => {
    const { status } = parseServerError(error);
    if (status !== null && status < 500) {
      // 서버가 거절했으면 처리되지 않았다 — 대기 안내를 지우고 보낸 입력으로 고칠 창을 연다
      setRetry(null);
      setDraft(sent);
      setAction(failed);
    } else {
      // 응답이 없거나(클라이언트가 500 으로 바꾼다) 5xx 면 처리됐는지 모른다 —
      // 창을 닫아 같은 요청 키로 다시 보내는 안내를 보인다
      setAction(null);
    }
    toast.error(
      getServerDenyMessage(
        error,
        `${ACTION_TITLE[failed]}에 실패했어요. 잠시 뒤 다시 시도해 주세요.`
      )
    );
  };

  // 버튼으로 여는 창은 새 작업이다 — 앞 작업의 사유·메모·체크를 넘기지 않는다
  const startAction = (next: Action) => {
    setDraft(freshDraft(shipment));
    setAction(next);
  };

  const retryAgain = async () => {
    if (!retry) return;
    try {
      await retry.run();
    } catch (error) {
      handleFailure(error, retry.action, retry.draft);
    }
  };

  const submit = async (originalKey?: string) => {
    if (!action) return;
    const idempotencyKey = createIdempotentCommand(
      {},
      originalKey
    ).idempotencyKey;
    const sent = draft;
    const quantity = Number(qty);
    try {
      if (action === 'split') {
        if (
          !line ||
          !isSplitQtyAllowed(
            quantity,
            line.qty,
            shipment.lines.reduce((sum, entry) => sum + entry.qty, 0)
          )
        ) {
          toast.error(SPLIT_QTY_ERROR);
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
          ...(note.trim() ? { note: note.trim() } : {}),
        };
        const run: () => Promise<void> = async () => {
          registerPending(idempotencyKey, action, sent, run);
          const result = await split.mutateAsync({
            shipmentId: shipment.id,
            data,
            idempotencyKey,
          });
          registerResult(result, idempotencyKey, action, sent, run);
        };
        await run();
        return;
      }
      if (action === 'recipient') {
        if (!reason.trim() || missingRecipientFields(recipient).length > 0) {
          toast.error('수령인 필수 정보와 작업 사유를 모두 입력하세요.');
          return;
        }
        const data = buildRecipientRevisionPayload(recipient, {
          expectedManifestVersion: shipment.manifestVersion,
          reason,
          note,
          currentSnapshot: shipment.recipientSnapshot,
        });
        const run: () => Promise<void> = async () => {
          registerPending(idempotencyKey, action, sent, run);
          const result = await reviseRecipient.mutateAsync({
            shipmentId: shipment.id,
            data,
            idempotencyKey,
          });
          registerResult(result, idempotencyKey, action, sent, run);
        };
        await run();
        return;
      }
      if (action === 'plan') {
        if (!chosenProfileId) {
          toast.error('배송 프로필을 고르세요.');
          return;
        }
        const data = {
          shippingProfileId: chosenProfileId,
          expectedManifestVersion: shipment.manifestVersion,
          expectedReservationVersion: shipment.reservationVersion,
        };
        const run: () => Promise<void> = async () => {
          registerPending(idempotencyKey, action, sent, run);
          const result = await plan.mutateAsync({
            shipmentId: shipment.id,
            data,
            idempotencyKey,
          });
          registerResult(result, idempotencyKey, action, sent, run);
        };
        await run();
        return;
      }
      if (!attemptId || !physicalRecovery) {
        toast.error('돌아온 출고를 고르고 상자를 돌려받았는지 확인하세요.');
        return;
      }
      const data = {
        dispatchAttemptId: attemptId,
        expectedManifestVersion: shipment.manifestVersion,
        physicalRecoveryConfirmed: true as const,
        reason: recallReason,
        ...(note.trim() ? { note: note.trim() } : {}),
      };
      const run: () => Promise<void> = async () => {
        registerPending(idempotencyKey, action, sent, run);
        const result = await recall.mutateAsync({
          shipmentId: shipment.id,
          data,
          idempotencyKey,
        });
        registerResult(result, idempotencyKey, action, sent, run);
      };
      await run();
    } catch (error) {
      handleFailure(error, action, sent);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {allowed.includes('split') && canRun(useSplitShipment) && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => startAction('split')}
          >
            분할
          </Button>
        )}
        {allowed.includes('recipient') &&
          canRun(useReviseShipmentRecipient) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => startAction('recipient')}
            >
              수령인 변경
            </Button>
          )}
        {allowed.includes('plan') && canRun(usePlanShipment) && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => startAction('plan')}
          >
            {ACTION_TITLE.plan}
          </Button>
        )}
        {canConsolidate && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConsolidating(true)}
          >
            합포장
          </Button>
        )}
        {canRecall && (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => startAction('recall')}
          >
            {ACTION_TITLE.recall}
          </Button>
        )}
      </div>

      {retry?.draft.shipmentId === shipment.id &&
        isRecoverableOperation(status) && (
          <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
            <RefreshCw />
            <AlertTitle>
              {retry.actionLabel} ·{' '}
              {operationStatusLabel(retry.operationId ? status : undefined)}
            </AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>{retryNotice(retry.operationId, status)}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={retryAgain}
                disabled={pending}
              >
                다시 시도
              </Button>
            </AlertDescription>
          </Alert>
        )}

      {canConsolidate && (
        <ConsolidationSheet
          shipmentId={shipment.id}
          open={consolidating}
          onOpenChange={setConsolidating}
        />
      )}

      <Dialog
        open={!!action && draft.shipmentId === shipment.id}
        onOpenChange={(open) => !open && setAction(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{action ? ACTION_TITLE[action] : ''}</DialogTitle>
          </DialogHeader>

          {action === 'split' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="split-line">나눌 상품</Label>
                <Select
                  value={lineId}
                  onValueChange={(value) => edit('lineId', value)}
                >
                  <SelectTrigger id="split-line" className="w-full">
                    <SelectValue placeholder="상품 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {shipment.lines.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {splitLineLabel(entry)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="split-qty">새 상자로 보낼 수량</Label>
                <Input
                  id="split-qty"
                  type="number"
                  min={1}
                  max={Math.max(maxMove, 1)}
                  value={qty}
                  onChange={(event) => edit('qty', event.target.value)}
                />
              </div>
              <div className="col-span-2">
                {preview ? (
                  <dl
                    role="status"
                    className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-muted/50 p-3 text-sm"
                  >
                    <dt className="text-muted-foreground">
                      이번 상자에 남을 수량
                    </dt>
                    <dd>
                      {lineName} {preview.lineStays}개 · 상자 전체{' '}
                      {preview.boxStays}개
                    </dd>
                    <dt className="text-muted-foreground">
                      새 상자로 보낼 수량
                    </dt>
                    <dd>
                      {lineName} {preview.moves}개
                    </dd>
                  </dl>
                ) : (
                  <p className="text-sm text-destructive">
                    {!line
                      ? '나눌 상품을 고르세요.'
                      : maxMove < 1
                        ? `이 상자에는 상품이 ${boxTotal}개뿐이라 나눌 수 없어요.`
                        : `1개부터 ${maxMove}개까지 보낼 수 있어요.`}
                  </p>
                )}
              </div>
            </div>
          )}

          {action === 'recipient' && (
            <div className="grid grid-cols-2 gap-3">
              {RECIPIENT_FIELDS.map(
                ({ key, label, placeholder, type, autoComplete }) => (
                  <div
                    key={key}
                    className={`space-y-1.5 ${key.includes('Address') ? 'col-span-2' : ''}`}
                  >
                    <Label htmlFor={`recipient-${key}`}>{label}</Label>
                    <Input
                      id={`recipient-${key}`}
                      value={recipient[key]}
                      placeholder={placeholder}
                      type={type}
                      autoComplete={autoComplete}
                      onChange={(event) =>
                        edit('recipient', {
                          ...recipient,
                          [key]: event.target.value,
                        })
                      }
                    />
                  </div>
                )
              )}
            </div>
          )}

          {action === 'plan' && (
            <div className="space-y-1.5">
              <Label htmlFor="plan-profile">배송 프로필</Label>
              <Select
                value={chosenProfileId}
                onValueChange={(value) => edit('shippingProfileId', value)}
                disabled={profiles.isLoading}
              >
                <SelectTrigger id="plan-profile">
                  <SelectValue
                    placeholder={profiles.isLoading ? '불러오는 중…' : '배송 프로필 선택'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(profiles.data ?? []).map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {profiles.isError && (
                <p className="text-xs text-red-600">
                  배송 프로필 목록을 불러오지 못했어요. 재고 조회 권한이 있는지 확인해 주세요.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                상품에 지정된 배송 프로필과 같아야 해요. 모르면 재고 → 배송 프로필 화면에서 이 상품이 속한 프로필을 확인하세요.
              </p>
            </div>
          )}

          {action === 'recall' && (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertDescription>
                  고객 반품이 아니에요. 보낸 상자가 택배사에 넘어가지 않고
                  창고로 돌아왔을 때만 실행하세요.
                </AlertDescription>
              </Alert>
              <div className="space-y-1.5">
                <Label htmlFor="recall-attempt">되돌릴 출고</Label>
                <Select
                  value={attemptId}
                  onValueChange={(value) => edit('attemptId', value)}
                >
                  <SelectTrigger id="recall-attempt" className="w-full">
                    <SelectValue placeholder="돌아온 출고 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {dispatchedAttempts.map((attempt) => (
                      <SelectItem key={attempt.id} value={attempt.id}>
                        {dispatchAttemptLabel(attempt, shipment.waybills)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recall-reason">되돌리는 이유</Label>
                <Select
                  value={recallReason}
                  onValueChange={(value) =>
                    edit('recallReason', value as RecallReason)
                  }
                >
                  <SelectTrigger id="recall-reason" className="w-full">
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
                    edit('physicalRecovery', checked === true)
                  }
                />
                <span>{recallConfirmText(isSupplier)}</span>
              </label>
            </div>
          )}

          {action !== 'plan' && action !== 'recall' && (
            <div className="space-y-1.5">
              <Label htmlFor="shipment-action-reason">작업 사유 (필수)</Label>
              <Input
                id="shipment-action-reason"
                value={reason}
                onChange={(event) => edit('reason', event.target.value)}
              />
            </div>
          )}
          {action !== 'plan' && (
            <div className="space-y-1.5">
              <Label htmlFor="shipment-action-note">운영 메모 (선택)</Label>
              <Textarea
                id="shipment-action-note"
                value={note}
                onChange={(event) => edit('note', event.target.value)}
                rows={2}
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>
              취소
            </Button>
            <Button
              variant={action === 'recall' ? 'destructive' : 'default'}
              onClick={() => submit()}
              disabled={
                pending ||
                (action === 'split' && !preview) ||
                (action === 'recall' && (!attemptId || !physicalRecovery))
              }
            >
              {pending ? '처리 중…' : action ? SUBMIT_LABEL[action] : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
