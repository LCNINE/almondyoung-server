'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
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
  useSplitShipment,
} from '@/lib/services/orders';
import { orderQueryKeys } from '@/lib/services/orders/query-keys';
import type {
  PreparationProfileSplit,
  SplitShipmentRequest,
} from '@/lib/types/dto/fulfillment';
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
 * 나누는 데 쓰는 줄은 출고 준비 응답이 함께 준다(받는 분 정보를 읽지 않는다). 목록이 낡았으면
 * 서버가 버전으로 거절하고, 목록을 다시 읽는다.
 */
export function ProfileSplitDialog({
  shipmentId,
  orderText,
  split: current,
  onClose,
}: {
  shipmentId: string;
  orderText: string;
  /** 지금 목록의 이 상자 — 목록을 다시 읽어 상자가 정보 부족에서 빠졌으면 null */
  split: PreparationProfileSplit | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const split = useSplitShipment();
  // 열 때 목록을 다시 읽고, 읽는 동안에는 나누지 않는다 — SKU 프로필이 바뀌어도 상자 버전은 그대로라
  // 서버가 낡은 묶음을 거절하지 못한다
  const refreshing =
    useIsFetching({ queryKey: orderQueryKeys.outboundPreparation }) > 0;
  useEffect(() => {
    void queryClient.invalidateQueries({
      queryKey: orderQueryKeys.outboundPreparation,
    });
  }, [queryClient]);
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [reason, setReason] = useState<OperationReasonValue>(PROFILE_REASON);
  const [showErrors, setShowErrors] = useState(false);
  // 응답을 못 받은 요청 — 같은 키·같은 내용으로 다시 보내야 두 번 나뉘지 않는다
  const [unanswered, setUnanswered] = useState<SplitRequest | null>(null);
  // 이 창 밖에서(앞서 닫은 창·상자 상세) 결과를 모르는 요청이 남아 있으면 새 키로 다시 나누지 않는다
  const unresolved = usePendingRequests(shipmentId).filter(
    (request) => request.idempotencyKey !== unanswered?.idempotencyKey
  );

  const state = useMemo(
    () => (current ? planProfileState(current.lines) : null),
    [current]
  );
  const groups = state?.kind === 'blocked' ? state.groups : [];
  const chosenKey = groupKey ?? defaultSplitGroupKey(groups);
  const moving =
    groups.length > 1
      ? groups.find((group) => group.key === chosenKey)
      : undefined;

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
        // 서버가 거절했다 — 처리되지 않았으니 목록을 다시 읽어 지금 상자로 고르게 한다
        forgetPending(idempotencyKey);
        setUnanswered(null);
        setGroupKey(null);
        toast.error(actionFailureMessage(error, 'split'));
        void queryClient.invalidateQueries({
          queryKey: orderQueryKeys.outboundPreparation,
        });
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
    if (!current || !moving) return;
    void send({
      shipmentId,
      data: {
        expectedManifestVersion: current.manifestVersion,
        moves: profileSplitMoves(moving),
        ...toOperationReasonPayload('split', reason),
      },
      idempotencyKey: createIdempotentCommand({}).idempotencyKey,
    });
  };

  const detailLink = (
    <Link
      href={`/order/fulfillments?shipmentId=${encodeURIComponent(shipmentId)}`}
      className="underline underline-offset-2"
    >
      상자 상세
    </Link>
  );

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

        {unanswered ? null : unresolved.length > 0 ? (
          <p role="status" className="text-sm break-keep">
            이 상자에 결과를 모르는 요청이 남아 있어 여기서 나누지 않아요.{' '}
            {detailLink}에서 그 요청이 처리됐는지 먼저 확인해 주세요.
          </p>
        ) : !current ? (
          <p role="status" className="text-sm break-keep">
            이 상자는 이제 정보 부족에 없어요. 바뀐 상태는 {detailLink}에서
            확인해 주세요.
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
                refreshing ||
                !moving ||
                unresolved.length > 0
              }
              onClick={submit}
            >
              {split.isPending
                ? '나누는 중…'
                : refreshing
                  ? '확인하는 중…'
                  : '나누기'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
