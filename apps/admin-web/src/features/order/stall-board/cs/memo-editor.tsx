'use client';

import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { isMaskedText } from '@/lib/api/domains/orders/order-cs.shape';
import { parseServerError } from '@/lib/api/server-error';
import { useUpdateSalesOrderMemo } from '@/lib/services/orders/mutations';
import { orderCsKeys } from '@/lib/services/orders/order-cs';
import type { MemoDraft } from './cs-drafts';

/** 주문 메모. 고치기 시작할 때 본 메모를 함께 보내, 그 사이 남이 바꿨으면 덮어쓰지 않는다. */
export function MemoEditor(props: {
  salesOrderId: string;
  memo: string;
  draft: MemoDraft | null;
  onDraft: (draft: MemoDraft | null) => void;
}) {
  const { draft: editing, onDraft: setEditing } = props;
  const queryClient = useQueryClient();
  const update = useUpdateSalesOrderMemo();
  const changed = editing !== null && editing.base !== props.memo;

  const save = () => {
    if (!editing) return;
    update.mutate(
      {
        id: props.salesOrderId,
        memo: editing.text,
        expectedMemo: editing.base,
      },
      {
        onSuccess: () => {
          setEditing(null);
          toast.success('메모를 저장했어요.');
          void queryClient.invalidateQueries({
            queryKey: orderCsKeys.order(props.salesOrderId),
          });
          void queryClient.invalidateQueries({
            queryKey: ['order-progress', 'orders'],
          });
        },
        onError: (error) => {
          const parsed = parseServerError(error, '메모를 저장하지 못했어요.');
          // 적던 글은 두고 바뀐 메모만 다시 읽는다
          if (parsed.conflict)
            void queryClient.invalidateQueries({
              queryKey: orderCsKeys.order(props.salesOrderId),
            });
          toast.error(parsed.message);
        },
      }
    );
  };

  return (
    <section aria-label="주문 메모" className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">주문 메모</h3>
        {editing === null && !isMaskedText(props.memo) && (
          <Can run={useUpdateSalesOrderMemo}>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setEditing({ text: props.memo, base: props.memo })}
            >
              {props.memo ? '고치기' : '적기'}
            </Button>
          </Can>
        )}
      </div>
      {(editing === null || changed) && (
        <p className="whitespace-pre-wrap break-words text-[13px]">
          {changed && (
            <span className="block text-xs font-semibold text-red-600">
              그 사이 다른 사람이 메모를 바꿨어요. 지금 메모는 아래와 같아요.
            </span>
          )}
          {props.memo || (
            <span className="text-muted-foreground">메모 없음</span>
          )}
        </p>
      )}
      {editing && (
        <div className="flex flex-col gap-1.5">
          <Textarea
            aria-label="메모 내용"
            rows={3}
            value={editing.text}
            disabled={update.isPending}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          />
          <div className="flex flex-wrap gap-1.5">
            {changed ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setEditing({
                    text: [props.memo, editing.text].filter(Boolean).join('\n'),
                    base: props.memo,
                  })
                }
              >
                바뀐 메모 뒤에 내 글 붙이기
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={update.isPending || editing.text === editing.base}
                onClick={save}
              >
                {update.isPending ? '저장 중...' : '저장'}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={update.isPending}
              onClick={() => setEditing(null)}
            >
              그만두기
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
