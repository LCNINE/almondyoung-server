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
  useConfirmInboundShipment,
  useUpdateInboundShipmentHeader,
} from '@/lib/services/inventory/inbound-shipment-mutations';
import { getFileSignedUrlFromFileService } from '@/lib/api/domains/files/upload.client';
import { isCustomError } from '@/lib/api/customError';
import type { InboundShipmentDetail } from '@/lib/types/dto/inbound-shipment';
import { confirmReadiness, shipmentActions } from '../../lib/shipment-rules';
import { needsAttention } from '../../lib/line-rules';
import { writeErrorMessage } from './mutation-error';

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
  const readiness = confirmReadiness(shipment, acknowledged);
  const attentionCount = shipment.lines.filter(needsAttention).length;

  const [name, setName] = useState(shipment.name);
  const [arrival, setArrival] = useState(shipment.expectedArrival?.slice(0, 10) ?? '');
  const [memo, setMemo] = useState(shipment.memo ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [overlaps, setOverlaps] = useState<string[]>([]);

  const dirty =
    name !== shipment.name ||
    arrival !== (shipment.expectedArrival?.slice(0, 10) ?? '') ||
    memo !== (shipment.memo ?? '');

  const saveHeader = () => {
    setMessage(null);
    update.mutate(
      { id: shipment.id, name, expectedArrival: arrival === '' ? null : arrival, memo: memo === '' ? null : memo },
      { onError: (e) => setMessage(writeErrorMessage(e)) },
    );
  };

  const doConfirm = () => {
    setMessage(null);
    confirm.mutate(
      { id: shipment.id, acknowledgedForwardBoxIds: readiness.acknowledgedForwardBoxIds },
      {
        onSuccess: (res) => {
          setOverlaps(res.labelOverlaps);
        },
        onError: (e) => {
          setMessage(writeErrorMessage(e));
          if (isCustomError(e) && e.statusCode === 409) onStale();
        },
      },
    );
  };

  const doCancel = () => {
    setMessage(null);
    cancel.mutate(shipment.id, {
      onSuccess: () => router.push('/inventory/inbound-shipments'),
      onError: (e) => setMessage(writeErrorMessage(e)),
    });
  };

  const openOriginal = async () => {
    if (!shipment.sourceFileId) return;
    try {
      const { signedUrl } = await getFileSignedUrlFromFileService(shipment.sourceFileId);
      window.open(signedUrl, '_blank', 'noopener');
    } catch (e) {
      setMessage(writeErrorMessage(e));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-64" value={name} disabled={!isDraft} onChange={(e) => setName(e.target.value)} aria-label="이름" />
        <Input
          type="date"
          className="w-40"
          value={arrival}
          disabled={!isDraft}
          onChange={(e) => setArrival(e.target.value)}
          aria-label="도착 예정일"
        />
        <Input className="w-64" placeholder="메모" value={memo} disabled={!isDraft} onChange={(e) => setMemo(e.target.value)} aria-label="메모" />
        {isDraft && dirty && (
          <Can run={useUpdateInboundShipmentHeader}>
            <Button size="sm" onClick={saveHeader} disabled={update.isPending || name.trim() === ''}>
              저장
            </Button>
          </Can>
        )}
        <div className="ml-auto flex items-center gap-2">
          {shipment.sourceFileId ? (
            <Button size="sm" variant="outline" onClick={() => void openOriginal()}>
              원본 ⬇
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">원본 없음</span>
          )}
          {isDraft && attentionCount > 0 && <span className="text-sm">미확인 {attentionCount}</span>}
          {actions.cancel && (
            <Can run={useCancelInboundShipment}>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline" disabled={cancel.isPending}>
                    취소
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogTitle>이 선적을 취소할까요?</AlertDialogTitle>
                  <AlertDialogDescription>취소하면 되돌릴 수 없습니다.</AlertDialogDescription>
                  <AlertDialogFooter>
                    <AlertDialogCancel>닫기</AlertDialogCancel>
                    <AlertDialogAction onClick={doCancel}>선적 취소</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </Can>
          )}
          {actions.confirm && (
            <Can run={useConfirmInboundShipment}>
              <span className="text-sm text-muted-foreground">
                {readiness.unresolvedStockLines > 0 && `미확인 ${readiness.unresolvedStockLines} `}
                {readiness.unacknowledgedForwardBoxIds.length > 0 &&
                  `전달용 미확인 ${readiness.unacknowledgedForwardBoxIds.length}`}
              </span>
              <Button size="sm" onClick={doConfirm} disabled={!readiness.enabled || confirm.isPending}>
                확정
              </Button>
            </Can>
          )}
        </div>
      </div>
      {message && <div className="text-sm text-destructive">{message}</div>}
      {overlaps.length > 0 && (
        <div className="text-sm text-amber-600">
          같은 창고의 열린 선적과 상자 이름이 겹칩니다: {overlaps.join(', ')}
        </div>
      )}
    </div>
  );
}
