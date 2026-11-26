'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import type {
  DeviceWorkAction,
  DeviceWorkItem,
} from '@/lib/api/domains/device-work';
import {
  useDeviceWork,
  useResolveDeviceWork,
} from '@/lib/services/device-work';
import {
  VERDICT_VIEW,
  confirmText,
  errorText,
  groupByDevice,
  lastReportText,
  resolvedText,
  waitingText,
  workText,
} from '../display';

const TONE: Record<'ok' | 'warn' | 'muted', string> = {
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warn: 'bg-amber-50 text-amber-800 border-amber-200',
  muted: 'bg-muted text-muted-foreground border-border',
};

export default function DeviceWorkTemplate() {
  const list = useDeviceWork();
  const resolve = useResolveDeviceWork();
  const [now, setNow] = useState(() => new Date());
  const [target, setTarget] = useState<{
    item: DeviceWorkItem;
    action: DeviceWorkAction;
  } | null>(null);
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const groups = useMemo(() => groupByDevice(list.data ?? []), [list.data]);

  const onConfirm = () => {
    if (!target) return;
    const { item, action } = target;
    // 결과 토스트는 mutateAsync 의 promise 에 건다 — mutate() 쪽 콜백은 다음 호출·언마운트로 유실된다
    resolve.mutateAsync({ operationKey: item.operationKey, action }).then(
      () => {
        setTarget(null);
        toast.success(resolvedText(action));
      },
      (e) => {
        setTarget(null);
        toast.error(errorText(e));
      }
    );
  };

  return (
    <div className="flex flex-col gap-4 p-5">
      <div>
        <h1 className="text-xl font-bold">기기 확인할 일</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          물류앱이 서버 응답을 받지 못해 반영됐는지 모르는 작업이에요. 기기가
          연결될 때마다 올리고, 서버 기록으로 반영 여부를 판정해요.
        </p>
      </div>
      {list.isError ? (
        <p className="text-sm text-red-600">
          불러오지 못했어요 — {errorText(list.error)}
        </p>
      ) : list.isPending ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : groups.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          확인할 일이 없어요.
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.deviceId} className="rounded-md border">
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b bg-muted/40 px-4 py-2">
              <h2 className="font-medium">{group.title}</h2>
              <span className="text-xs text-muted-foreground">
                {lastReportText(group.lastReportedAt, now)}
              </span>
            </header>
            <ul className="divide-y">
              {group.items.map((item) => {
                const view = VERDICT_VIEW[item.verdict];
                const action = view.action;
                return (
                  <li
                    key={item.operationKey}
                    className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-start"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-medium">
                        {workText(item)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {waitingText(item, now)}
                      </p>
                      <p className="mt-1 text-sm">{view.next}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={cn(
                          'rounded border px-2 py-0.5 text-xs font-medium',
                          TONE[view.tone]
                        )}
                      >
                        {view.label}
                      </span>
                      {action && (
                        <Can run={useResolveDeviceWork}>
                          <Button
                            size="sm"
                            variant={
                              action.kind === 'abandon'
                                ? 'destructive'
                                : 'outline'
                            }
                            disabled={resolve.isPending}
                            onClick={() =>
                              setTarget({ item, action: action.kind })
                            }
                          >
                            {action.label}
                          </Button>
                        </Can>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      <AlertDialog
        open={target !== null}
        onOpenChange={(open) => !open && !resolve.isPending && setTarget(null)}
      >
        <AlertDialogContent>
          {target && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {confirmText(target.item, target.action).title}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {confirmText(target.item, target.action).body}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={resolve.isPending}>
                  취소
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={resolve.isPending}
                  onClick={(e) => {
                    e.preventDefault();
                    onConfirm();
                  }}
                >
                  {target.action === 'abandon' ? '버리기' : '목록에서 빼기'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
