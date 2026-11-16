'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  useCancelInboundShipment,
  useCloseInboundShipment,
  useReopenInboundShipment,
  useConfirmInboundShipment,
  useUpdateInboundShipmentHeader,
} from '@/lib/services/inventory/inbound-shipment-mutations';
import { getFileSignedUrlFromFileService } from '@/lib/api/domains/files/upload.client';
import { isCustomError } from '@/lib/api/customError';
import { toLocalDateString } from '@/lib/utils/date';
import {
  formatMonthDay,
  isArrivalOverdue,
  showPromisedArrival,
} from '../../lib/arrival-overdue';
import type { InboundShipmentDetail } from '@/lib/types/dto/inbound-shipment';
import {
  CLOSE_REASON_MAX,
  confirmReadiness,
  MAX_MEMO_LENGTH,
  MAX_SHIPMENT_NAME_LENGTH,
  normalizeCloseReason,
  SHIPMENT_STATUS_LABEL,
  shipmentActions,
} from '../../lib/shipment-rules';
import { needsAttention } from '../../lib/line-rules';
import { writeErrorMessage } from './mutation-error';
import { useSyncedState } from '../../lib/use-synced-state';
import { useWarehouses } from '@/lib/services/inventory/queries';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  shipment: InboundShipmentDetail;
  acknowledged: ReadonlySet<string>;
  /** 서버가 «지금 상태와 안 맞다» 고 하면 화면이 낡은 것이다. */
  onStale: () => void;
}

export function ShipmentHeader({ shipment, acknowledged, onStale }: Props) {
  const router = useRouter();
  const update = useUpdateInboundShipmentHeader();
  const confirm = useConfirmInboundShipment();
  const cancel = useCancelInboundShipment();
  const actions = shipmentActions(shipment);
  const isDraft = shipment.status === 'draft';
  // 서버는 취소된 선적만 머리 수정을 거절한다 — 확정 뒤에도 도착 예정일을 고친다.
  const editsHeader = shipment.status !== 'canceled';
  const { data: warehouses = [] } = useWarehouses();
  const warehouseName = warehouses.find(
    (w) => w.id === shipment.warehouseId
  )?.name;
  const readiness = confirmReadiness(shipment, acknowledged);
  const attentionCount = shipment.lines.filter(needsAttention).length;

  // refetch 로 서버 값이 바뀌면 따라간다(고치는 중인 칸은 지킨다).
  const [name, setName] = useSyncedState(shipment.name);
  const [arrival, setArrival] = useSyncedState(
    shipment.expectedArrival?.slice(0, 10) ?? ''
  );
  const [memo, setMemo] = useSyncedState(shipment.memo ?? '');
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeText, setCloseText] = useState('');
  const closeShipment = useCloseInboundShipment();
  const reopen = useReopenInboundShipment();
  const closeInput = normalizeCloseReason(closeText);
  const [message, setMessage] = useState<string | null>(null);
  const [overlaps, setOverlaps] = useState<string[]>([]);

  const dirty =
    name !== shipment.name ||
    arrival !== (shipment.expectedArrival?.slice(0, 10) ?? '') ||
    memo !== (shipment.memo ?? '');

  const saveHeader = () => {
    setMessage(null);
    update.mutate(
      {
        id: shipment.id,
        name,
        expectedArrival: arrival === '' ? null : arrival,
        memo: memo === '' ? null : memo,
      },
      { onError: onWriteError }
    );
  };

  const doConfirm = () => {
    setMessage(null);
    confirm.mutate(
      {
        id: shipment.id,
        acknowledgedForwardBoxIds: readiness.acknowledgedForwardBoxIds,
      },
      {
        onSuccess: (res) => {
          setOverlaps(res.labelOverlaps);
        },
        onError: (e) => {
          setMessage(writeErrorMessage(e));
          if (isCustomError(e) && e.statusCode === 409) onStale();
        },
      }
    );
  };

  const onWriteError = (e: unknown) => {
    setMessage(writeErrorMessage(e));
    if (isCustomError(e) && e.statusCode === 409) onStale();
  };

  const doClose = () => {
    if (!closeInput.ok) return;
    setMessage(null);
    closeShipment.mutate(
      { id: shipment.id, reason: closeInput.reason },
      {
        onSuccess: () => {
          setCloseOpen(false);
          setCloseText('');
        },
        onError: onWriteError,
      }
    );
  };

  const doReopen = () => {
    setMessage(null);
    reopen.mutate(shipment.id, { onError: onWriteError });
  };

  const doCancel = () => {
    setMessage(null);
    cancel.mutate(shipment.id, {
      onSuccess: () => router.push('/inventory/inbound-shipments'),
      onError: onWriteError,
    });
  };

  const openOriginal = async () => {
    if (!shipment.sourceFileId) return;
    try {
      // await 뒤 window.open 은 팝업 차단에 걸린다 — 내려받기 강제로 현재 창에서 연다.
      const { signedUrl } = await getFileSignedUrlFromFileService(
        shipment.sourceFileId,
        300,
        { forceDownload: true }
      );
      window.location.href = signedUrl;
    } catch (e) {
      setMessage(writeErrorMessage(e));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-64"
          value={name}
          maxLength={MAX_SHIPMENT_NAME_LENGTH}
          disabled={!editsHeader}
          onChange={(e) => setName(e.target.value)}
          aria-label="이름"
        />
        <Badge variant="outline">
          {SHIPMENT_STATUS_LABEL[shipment.status]}
        </Badge>
        {isArrivalOverdue(
          shipment.status,
          shipment.expectedArrival,
          toLocalDateString(new Date())
        ) && <Badge variant="destructive">예정일 지남</Badge>}
        {warehouseName && (
          <span className="text-sm text-muted-foreground">{warehouseName}</span>
        )}
        <Input
          type="date"
          className="w-40"
          value={arrival}
          disabled={!editsHeader}
          onChange={(e) => setArrival(e.target.value)}
          aria-label="도착 예정일"
        />
        {showPromisedArrival(
          shipment.expectedArrival,
          shipment.promisedArrival
        ) &&
          shipment.promisedArrival && (
            <span className="text-sm text-muted-foreground">
              처음 예정 {formatMonthDay(shipment.promisedArrival)}
            </span>
          )}
        <Input
          className="w-64"
          placeholder="메모"
          value={memo}
          maxLength={MAX_MEMO_LENGTH}
          disabled={!editsHeader}
          onChange={(e) => setMemo(e.target.value)}
          aria-label="메모"
        />
        {editsHeader && dirty && (
          <Can run={useUpdateInboundShipmentHeader}>
            <Button
              size="sm"
              onClick={saveHeader}
              disabled={update.isPending || name.trim() === ''}
            >
              저장
            </Button>
          </Can>
        )}
        <div className="ml-auto flex items-center gap-2">
          {shipment.sourceFileId ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void openOriginal()}
            >
              원본 ⬇
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">원본 없음</span>
          )}
          {isDraft && attentionCount > 0 && (
            <span className="text-sm">확인 필요 {attentionCount}</span>
          )}
          {actions.cancel && (
            <Can run={useCancelInboundShipment}>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={cancel.isPending}
                  >
                    취소
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogTitle>이 선적을 취소할까요?</AlertDialogTitle>
                  <AlertDialogDescription>
                    취소하면 되돌릴 수 없습니다.
                  </AlertDialogDescription>
                  <AlertDialogFooter>
                    <AlertDialogCancel>닫기</AlertDialogCancel>
                    <AlertDialogAction onClick={doCancel}>
                      선적 취소
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </Can>
          )}
          {actions.close && (
            <Can run={useCloseInboundShipment}>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setMessage(null);
                  setCloseOpen(true);
                }}
              >
                끝내기…
              </Button>
            </Can>
          )}
          {actions.reopen && (
            <Can run={useReopenInboundShipment}>
              <Button
                size="sm"
                variant="outline"
                disabled={reopen.isPending}
                onClick={doReopen}
              >
                다시 열기
              </Button>
            </Can>
          )}
          {actions.confirm && (
            <Can run={useConfirmInboundShipment}>
              <span className="text-sm text-muted-foreground">
                {readiness.unresolvedStockLines > 0 &&
                  `재고 상자를 막는 미확인 ${readiness.unresolvedStockLines} `}
                {readiness.unacknowledgedForwardBoxIds.length > 0 &&
                  `전달용 미확인 ${readiness.unacknowledgedForwardBoxIds.length}`}
              </span>
              <Button
                size="sm"
                onClick={doConfirm}
                disabled={!readiness.enabled || confirm.isPending}
              >
                확정
              </Button>
            </Can>
          )}
        </div>
      </div>
      {shipment.status === 'closed' && shipment.closedReason && (
        <div className="text-sm text-muted-foreground">
          끝낸 사유: {shipment.closedReason}
          {shipment.closedAt
            ? ` · ${new Date(shipment.closedAt).toLocaleString('ko-KR')}`
            : ''}
        </div>
      )}
      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent>
          <DialogTitle>선적 끝내기</DialogTitle>
          <DialogDescription>
            끝내는 사유를 적어 주세요. 다시 열 수 있습니다.
          </DialogDescription>
          <Textarea
            value={closeText}
            maxLength={CLOSE_REASON_MAX}
            onChange={(e) => setCloseText(e.target.value)}
            aria-label="끝내는 사유"
            rows={4}
          />
          {/* 모달 뒤에 가리지 않게 대화상자 안에 보여 준다. 열어 둬서 적은 사유를 지키고, 409 면 이미 refetch 중이다. */}
          {message && <div className="text-sm text-destructive">{message}</div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseOpen(false)}>
              닫기
            </Button>
            <Button
              onClick={doClose}
              disabled={!closeInput.ok || closeShipment.isPending}
            >
              끝내기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {message && !closeOpen && (
        <div className="text-sm text-destructive">{message}</div>
      )}
      {overlaps.length > 0 && (
        <div className="text-sm text-amber-600">
          같은 창고의 열린 선적과 상자 이름이 겹칩니다: {overlaps.join(', ')}
        </div>
      )}
    </div>
  );
}
