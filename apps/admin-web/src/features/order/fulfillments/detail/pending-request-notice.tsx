'use client';

import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useFulfillmentRequestOutcome } from '@/lib/services/orders';
import {
  ACTION_TITLE,
  PENDING_SETTLE_MS,
  pendingOutcomeNotice,
  type PendingOutcomeNotice,
} from './shipment-action-copy';
import {
  REQUEST_COMMAND_TYPE,
  type PendingRequest,
} from './shipment-action-pending';

const TONE_CLASS: Record<PendingOutcomeNotice['tone'], string> = {
  checking: '',
  done: 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20',
  attention: 'border-amber-300 bg-amber-50 dark:bg-amber-950/20',
  not_processed: 'border-amber-300 bg-amber-50 dark:bg-amber-950/20',
};

/** 새로고침 등으로 «다시 시도» 안내가 사라진 요청의 결과를 서버에 물어 알린다 */
export function PendingRequestNotice({
  request,
  onRedo,
  onDismiss,
}: {
  request: PendingRequest;
  onRedo: () => void;
  onDismiss: () => void;
}) {
  const outcome = useFulfillmentRequestOutcome(
    REQUEST_COMMAND_TYPE[request.action],
    request.idempotencyKey,
    request.sentAt,
    PENDING_SETTLE_MS
  );
  const subject = `앞서 보낸 ${ACTION_TITLE[request.action]} 요청`;

  // «처리 안 됨»은 그 답을 받은 시각 기준으로 판단한다
  const notice = outcome.data
    ? pendingOutcomeNotice(
        request.action,
        request.sentAt,
        outcome.data,
        outcome.dataUpdatedAt || Date.now()
      )
    : null;

  // 아직 결론이 없는데 묻다 실패했으면(앞서 받은 답이 있어도) 다시 묻게 한다
  if (!notice || (outcome.isError && notice.tone === 'checking')) {
    const failed = outcome.isError;
    return (
      <Alert role="status" className={failed ? TONE_CLASS.attention : ''}>
        {failed ? <CircleAlert /> : <Loader2 className="animate-spin" />}
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {failed
              ? `${subject}의 결과를 확인하지 못했어요. 연결을 확인하고 다시 확인해 주세요.`
              : `${subject}의 결과를 확인하고 있어요.`}
          </span>
          {failed && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => outcome.refetch()}
            >
              다시 확인
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert role="status" className={TONE_CLASS[notice.tone]}>
      {notice.tone === 'done' ? (
        <CheckCircle2 />
      ) : notice.tone === 'checking' ? (
        <Loader2 className="animate-spin" />
      ) : (
        <CircleAlert />
      )}
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>{notice.text}</span>
        {notice.tone === 'not_processed' ? (
          <span className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onRedo}>
              다시 하기
            </Button>
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              닫기
            </Button>
          </span>
        ) : notice.tone === 'checking' ? null : (
          <Button size="sm" variant="outline" onClick={onDismiss}>
            확인
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
