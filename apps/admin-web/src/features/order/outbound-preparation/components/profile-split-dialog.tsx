'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  createIdempotentCommand,
  parseServerError,
  useShipmentDetail,
  useSplitShipment,
} from '@/lib/services/orders';
import type { SplitShipmentRequest } from '@/lib/types/dto/fulfillment';
import { OperationReasonFields } from '@/features/order/fulfillments/detail/operation-reason-fields';
import {
  canSubmitOperationReason,
  toOperationReasonPayload,
  type OperationReasonValue,
} from '@/features/order/fulfillments/detail/operation-reasons';
import {
  defaultSplitGroupKey,
  planProfileState,
  profileSplitMoves,
} from '@/features/order/fulfillments/detail/plan-profile';
import { ProfileSplitFields } from '@/features/order/fulfillments/detail/profile-split-fields';
import { actionFailureMessage } from '@/features/order/fulfillments/detail/shipment-action-copy';
import {
  forgetPending,
  rememberPending,
  usePendingRequests,
} from '@/features/order/fulfillments/detail/shipment-action-pending';
import { shipmentActionsFor } from '@/features/order/fulfillments/detail/shipment-owner';

type SplitRequest = {
  shipmentId: string;
  data: SplitShipmentRequest;
  idempotencyKey: string;
};

const PROFILE_REASON: OperationReasonValue = {
  reasonCode: 'profile_mismatch',
  otherText: '',
  note: '',
};

const NO_ANSWER =
  '응답을 받지 못했어요. «같은 요청 다시 보내기»를 누르면 한 번만 처리돼요.';

/**
 * 출고 준비 «정보 부족»에서 배송 프로필이 섞인 상자를 그 자리에서 프로필별로 나눈다.
 * 목록 응답에는 줄 버전이 없어 상자를 새로 읽고, 상자 상세의 프로필 분할과 같은 요청을 보낸다.
 */
export function ProfileSplitDialog({
  shipmentId,
  orderText,
  onClose,
}: {
  shipmentId: string;
  orderText: string;
  onClose: () => void;
}) {
  const detail = useShipmentDetail(shipmentId, { refetchOnMount: 'always' });
  const split = useSplitShipment();
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [reason, setReason] = useState<OperationReasonValue>(PROFILE_REASON);
  const [showErrors, setShowErrors] = useState(false);
  // 응답을 못 받은 요청 — 같은 키·같은 내용으로 다시 보내야 두 번 나뉘지 않는다
  const [unanswered, setUnanswered] = useState<SplitRequest | null>(null);

  // 이 창 밖에서(앞서 닫은 창·상자 상세) 결과를 모르는 요청이 남아 있으면 새 키로 다시 나누지 않는다
  const unresolved = usePendingRequests(shipmentId).filter(
    (request) => request.idempotencyKey !== unanswered?.idempotencyKey
  );
  const shipment = detail.isFetching ? undefined : detail.data;
  const state = useMemo(
    () => (shipment ? planProfileState(shipment.lines) : null),
    [shipment]
  );
  const groups = state?.kind === 'blocked' ? state.groups : [];
  const chosenKey = groupKey ?? defaultSplitGroupKey(groups);
  const moving =
    groups.length > 1
      ? groups.find((group) => group.key === chosenKey)
      : undefined;
  const splittable =
    !!shipment && shipmentActionsFor(shipment).includes('split');

  const send = async (request: SplitRequest) => {
    const { idempotencyKey } = request;
    rememberPending({
      shipmentId: request.shipmentId,
      action: 'split',
      idempotencyKey,
      sentAt: Date.now(),
    });
    try {
      // 분할은 끝낸 뒤에 응답한다 — 응답을 받았으면 나뉜 것이다
      await split.mutateAsync(request);
      forgetPending(idempotencyKey);
      setUnanswered(null);
      toast.success(`${orderText} 상자를 배송 프로필별로 나눴어요.`);
      onClose();
    } catch (error) {
      const { status } = parseServerError(error);
      if (status !== null && status < 500) {
        // 서버가 거절했다 — 처리되지 않았으니 지금 상자로 다시 고르게 한다
        forgetPending(idempotencyKey);
        setUnanswered(null);
        setGroupKey(null);
        toast.error(actionFailureMessage(error, 'split'));
        void detail.refetch();
        return;
      }
      setUnanswered(request);
    }
  };

  const submit = () => {
    if (!canSubmitOperationReason('split', reason)) {
      setShowErrors(true);
      return;
    }
    if (!shipment || !moving || unresolved.length > 0) return;
    void send({
      shipmentId: shipment.id,
      data: {
        expectedManifestVersion: shipment.manifestVersion,
        moves: profileSplitMoves(moving),
        ...toOperationReasonPayload('split', reason),
      },
      idempotencyKey: createIdempotentCommand({}).idempotencyKey,
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !split.isPending && onClose()}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>배송 프로필별로 나누기</DialogTitle>
          <DialogDescription>
            {orderText} — 같은 배송 프로필의 상품을 모두 새 상자로 옮겨요.
          </DialogDescription>
        </DialogHeader>

        {detail.isError && !detail.isFetching ? (
          <div role="alert" className="space-y-2 text-sm">
            <p>상자 정보를 불러오지 못했어요.</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => detail.refetch()}
            >
              다시 불러오기
            </Button>
          </div>
        ) : !shipment || !state ? (
          <p role="status" className="text-sm text-muted-foreground">
            상자 정보를 불러오는 중이에요.
          </p>
        ) : unresolved.length > 0 ? (
          <p role="status" className="text-sm break-keep">
            이 상자에 결과를 모르는 요청이 남아 있어 여기서 나누지 않아요.{' '}
            <Link
              href={`/order/fulfillments?shipmentId=${encodeURIComponent(shipmentId)}`}
              className="underline underline-offset-2"
            >
              상자 상세
            </Link>
            에서 그 요청이 처리됐는지 먼저 확인해 주세요.
          </p>
        ) : !splittable || state.kind === 'unknown' ? (
          <p role="status" className="text-sm break-keep">
            지금은 여기서 나눌 수 없어요.{' '}
            <Link
              href={`/order/fulfillments?shipmentId=${encodeURIComponent(shipmentId)}`}
              className="underline underline-offset-2"
            >
              상자 상세
            </Link>
            에서 상태를 확인해 주세요.
          </p>
        ) : (
          <div className="space-y-4">
            <ProfileSplitFields
              groups={groups}
              groupKey={chosenKey}
              onGroupKeyChange={setGroupKey}
            />
            {groups.length > 1 && (
              <OperationReasonFields
                type="split"
                value={reason}
                onChange={setReason}
                showErrors={showErrors}
              />
            )}
          </div>
        )}

        {unanswered && (
          <p role="alert" className="text-sm break-keep text-amber-700">
            {NO_ANSWER}
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={split.isPending}
            onClick={onClose}
          >
            닫기
          </Button>
          {unanswered ? (
            <Button
              disabled={split.isPending}
              onClick={() => void send(unanswered)}
            >
              같은 요청 다시 보내기
            </Button>
          ) : (
            <Button
              disabled={
                split.isPending ||
                !splittable ||
                !moving ||
                unresolved.length > 0
              }
              onClick={submit}
            >
              {split.isPending ? '나누는 중…' : '나누기'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
