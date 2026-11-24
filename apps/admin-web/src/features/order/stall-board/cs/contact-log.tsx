'use client';

import { toast } from 'sonner';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  CONTACT_OUTCOMES,
  followUpText,
  outcomeLabel,
} from '@/lib/api/domains/orders/order-cs.shape';
import { parseServerError } from '@/lib/api/server-error';
import {
  useCreateOrderContact,
  useOrderContacts,
} from '@/lib/services/orders/order-cs';
import { kstToday } from '@/features/order/matching/lib/date-key';
import { useOperatorNames } from '@/features/order/fulfillments/detail/operation-operator';
import { cn } from '@/lib/utils/ui';
import { emptyContactDraft, type ContactDraft } from './cs-drafts';

/** 내용이 바뀌면 다른 저장이다 — 앞 시도가 이미 들어갔을 수 있어 새 id 로 보낸다. */
const edit = (
  draft: ContactDraft,
  patch: Partial<ContactDraft>
): ContactDraft => ({
  ...draft,
  ...patch,
  requestId: crypto.randomUUID(),
});

const timeText = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    dateStyle: 'short',
    timeStyle: 'short',
  });

export function ContactLog(props: {
  salesOrderId: string;
  draft: ContactDraft;
  onDraft: (draft: ContactDraft) => void;
}) {
  const { draft, onDraft } = props;
  const contacts = useOrderContacts(props.salesOrderId);
  const create = useCreateOrderContact();
  const names = useOperatorNames(contacts.data?.map((c) => c.authorId) ?? []);
  const today = kstToday();

  const save = () => {
    if (!draft.outcome) {
      toast.error('통화함·부재·문자 중 하나를 고르세요.');
      return;
    }
    create.mutate(
      {
        id: draft.requestId,
        salesOrderId: props.salesOrderId,
        outcome: draft.outcome,
        body: draft.body.trim(),
        followUpOn: draft.followUpOn || null,
      },
      {
        onSuccess: () => {
          onDraft(emptyContactDraft());
          toast.success('연락 기록을 남겼어요.');
        },
        onError: (error) => {
          const parsed = parseServerError(error);
          toast.error(
            parsed.status === null
              ? '저장됐는지 확인하지 못했어요. 다시 누르면 한 번만 남아요.'
              : parsed.message
          );
        },
      }
    );
  };

  return (
    <section aria-label="연락 기록" className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">연락 기록</h3>
      <Can run={useCreateOrderContact}>
        <div className="flex flex-wrap items-center gap-1.5">
          {CONTACT_OUTCOMES.map((o) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={draft.outcome === o.key}
              disabled={create.isPending}
              onClick={() => onDraft(edit(draft, { outcome: o.key }))}
              className={cn(
                'rounded-md border px-2.5 py-1 text-[13px]',
                draft.outcome === o.key &&
                  'border-foreground bg-foreground text-background'
              )}
            >
              {o.label}
            </button>
          ))}
          <Input
            aria-label="연락 내용"
            className="h-8 min-w-48 flex-1 text-sm"
            placeholder="예: 먼저 받겠다고 함"
            maxLength={1000}
            value={draft.body}
            disabled={create.isPending}
            onChange={(e) => onDraft(edit(draft, { body: e.target.value }))}
          />
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            다시 연락
            <Input
              type="date"
              aria-label="다시 연락할 날"
              className="h-8 w-36 text-sm"
              min={today}
              value={draft.followUpOn}
              disabled={create.isPending}
              onChange={(e) =>
                onDraft(edit(draft, { followUpOn: e.target.value }))
              }
            />
          </label>
          <Button
            size="sm"
            className="h-8"
            disabled={create.isPending || !draft.outcome}
            onClick={save}
          >
            {create.isPending ? '저장 중...' : '남기기'}
          </Button>
        </div>
      </Can>
      {contacts.data === undefined ? (
        contacts.isError ? (
          <RetryLine
            text="연락 기록을 불러오지 못했어요."
            onRetry={() => void contacts.refetch()}
          />
        ) : (
          <p className="text-xs text-muted-foreground">불러오는 중…</p>
        )
      ) : (
        <>
          {contacts.isError && (
            <RetryLine
              text="새 기록을 확인하지 못했어요. 아래는 조금 전 기록이에요."
              onRetry={() => void contacts.refetch()}
            />
          )}
          {contacts.data.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              아직 연락하지 않았어요.
            </p>
          ) : (
            <ul
              aria-label="연락 기록 목록"
              className="max-h-40 space-y-1 overflow-y-auto text-[13px]"
            >
              {contacts.data.map((c, i) => {
                // 다시 연락할 날은 가장 최근 기록의 것만 살아 있다
                const follow =
                  i === 0 ? followUpText(c.followUpOn, today) : null;
                return (
                  <li key={c.id} className="flex flex-wrap gap-x-2">
                    <span className="tabular-nums text-muted-foreground">
                      {timeText(c.at)}
                    </span>
                    {names(c.authorId) && <span>{names(c.authorId)}</span>}
                    <span className="font-medium">
                      {outcomeLabel(c.outcome)}
                    </span>
                    {c.body && <span className="break-all">{c.body}</span>}
                    {follow && (
                      <span
                        className={cn(
                          follow.due && 'font-semibold text-red-600'
                        )}
                      >
                        {follow.text}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export function RetryLine(props: { text: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-2 text-xs text-red-600">
      <span>{props.text}</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={props.onRetry}
      >
        다시 시도
      </Button>
    </div>
  );
}
