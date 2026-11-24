'use client';

import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { parseServerError } from '@/lib/api/server-error';
import type {
  CarrierTrackingItem,
  ConfirmCarrierTrackingRequest,
} from '@/lib/api/domains/orders/carrier-tracking.client';
import { useConfirmCarrierTracking } from '@/lib/services/orders/carrier-tracking';
import {
  attentionText,
  confirmationText,
  kstDateTime,
} from './carrier-tracking-copy';

const NOTE_MAX = 500;

/**
 * 택배사에 확인한 것을 남긴다. `opened` 는 창을 연 때의 값, `latest` 는 지금 목록의 값 — 풀렸거나 끝났으면 undefined.
 */
export function CarrierConfirmDialog({
  opened,
  latest,
  now,
  actorName,
  onClose,
}: {
  opened: CarrierTrackingItem;
  latest: CarrierTrackingItem | undefined;
  now: Date;
  actorName: (id: string | null | undefined) => string;
  onClose: () => void;
}) {
  const confirm = useConfirmCarrierTracking();
  const id = useId();
  const [outcome, setOutcome] = useState<'wait' | 'closed'>('wait');
  const [note, setNote] = useState('');
  const [showError, setShowError] = useState(false);
  // 연 때 본 상태 — 그 사이 바뀌면 다시 읽고 확인하게 한다
  const [seen, setSeen] = useState(opened);
  const [changed, setChanged] = useState(false);
  // 응답을 못 받은 요청은 같은 키·같은 내용으로 다시 보내야 한 번만 남는다
  const [unanswered, setUnanswered] = useState<{
    dispatchAttemptId: string;
    data: ConfirmCarrierTrackingRequest;
    idempotencyKey: string;
  } | null>(null);
  const busy = confirm.isPending;
  const current = changed ? latest : seen;

  const send = async (request: NonNullable<typeof unanswered>) => {
    try {
      const result = await confirm.mutateAsync(request);
      toast.success(
        result.resumeAt
          ? `확인 기록을 남겼어요. ${kstDateTime(result.resumeAt)}까지 그대로면 다시 떠요.`
          : '확인 기록을 남기고 끝냈어요.'
      );
      onClose();
    } catch (error) {
      const { status, code } = parseServerError(error);
      if (status === null || status >= 500) {
        setUnanswered(request);
        return;
      }
      setUnanswered(null);
      if (code === 'CARRIER_TRACKING_NOT_NEEDED') {
        toast.info('그 사이 풀려서 남길 확인이 없어요.');
        onClose();
        return;
      }
      if (code === 'CARRIER_TRACKING_CHANGED') {
        setChanged(true);
        return;
      }
      toast.error(
        parseServerError(error, '확인 기록을 남기지 못했어요.').message
      );
    }
  };

  const submit = () => {
    if (!current?.kind) return;
    if (!note.trim()) {
      setShowError(true);
      return;
    }
    setSeen(current);
    setChanged(false);
    void send({
      dispatchAttemptId: current.dispatchAttemptId,
      data: {
        outcome,
        note: note.trim(),
        expectedKind: current.kind,
        expectedScanKey: current.scanKey,
        expectedConfirmationId: current.confirmations[0]?.id ?? null,
      },
      idempotencyKey: crypto.randomUUID(),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>송장 {opened.trackingNo} 확인 기록</DialogTitle>
          <DialogDescription className="break-keep">
            {(current && attentionText(current, now)) ||
              '확인할 것이 없어졌어요.'}
          </DialogDescription>
        </DialogHeader>
        {changed && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {current
              ? '다른 사람이 먼저 기록했거나 택배사 상태가 바뀌었어요. 아래를 보고 다시 남겨 주세요.'
              : '다른 사람이 먼저 끝냈거나 택배사 기록이 왔어요. 남긴 기록은 상자 상세에서 볼 수 있어요.'}
          </p>
        )}
        {current && current.confirmations.length > 0 && (
          <ul
            role="list"
            aria-label="앞선 확인 기록"
            className="space-y-1 rounded-md border p-3 text-xs text-muted-foreground"
          >
            {current.confirmations.map((row) => (
              <li key={row.id} className="break-words">
                {confirmationText(row, actorName(row.actorId))}
              </li>
            ))}
          </ul>
        )}
        {!unanswered && current?.kind && (
          <div className="space-y-4">
            <RadioGroup
              value={outcome}
              onValueChange={(value) =>
                setOutcome(value === 'closed' ? 'closed' : 'wait')
              }
              aria-label="확인한 결과"
            >
              <div className="flex items-start gap-2">
                <RadioGroupItem value="wait" id={`${id}-wait`} />
                <Label
                  htmlFor={`${id}-wait`}
                  className="break-keep font-normal leading-normal"
                >
                  다음 영업일까지 기다림 — 그때도 그대로면 다시 떠요
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="closed" id={`${id}-closed`} />
                <Label
                  htmlFor={`${id}-closed`}
                  className="break-keep font-normal leading-normal"
                >
                  더 볼 것 없음 — 새 택배사 기록이 오기 전에는 다시 안 떠요
                </Label>
              </div>
            </RadioGroup>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-note`}>확인한 내용</Label>
              <Textarea
                id={`${id}-note`}
                value={note}
                maxLength={NOTE_MAX}
                placeholder="예: 부천 지점 통화, 오늘 저녁 집하 예정"
                aria-invalid={showError && !note.trim()}
                onChange={(event) => setNote(event.target.value)}
              />
              {showError && !note.trim() && (
                <p role="alert" className="text-sm text-destructive">
                  다음 사람이 볼 수 있게 확인한 내용을 적어 주세요.
                </p>
              )}
            </div>
          </div>
        )}
        {unanswered && (
          <p role="alert" className="text-sm font-medium text-destructive">
            응답을 받지 못했어요. «같은 기록 다시 보내기»를 누르면 한 번만
            남아요.
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            닫기
          </Button>
          <Can run={useConfirmCarrierTracking}>
            {unanswered ? (
              <Button
                type="button"
                disabled={busy}
                onClick={() => void send(unanswered)}
              >
                같은 기록 다시 보내기
              </Button>
            ) : (
              <Button
                type="button"
                disabled={busy || !current?.kind}
                onClick={submit}
              >
                확인 기록 남기기
              </Button>
            )}
          </Can>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
