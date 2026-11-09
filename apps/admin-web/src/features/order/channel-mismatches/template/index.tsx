'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { MismatchListScope } from '@/lib/api/domains/channel/order-reconcile-findings.shape';
import {
  useMismatches,
  useReservationReconcileRuns,
} from '@/lib/services/channel/queries';
import {
  useApplyReservationRun,
  useCloseMismatch,
  useCloseReservationRun,
  useRedeliverMismatch,
} from '@/lib/services/channel/mutations';
import {
  RUN_REASON_MAX,
  applyOutcome,
  canAct,
  exampleText,
  haltedRunText,
  latestRunText,
  unknownText,
  emptyText,
  firstSeenText,
  handlingText,
  kindLabel,
  lastResultText,
  loadErrorText,
  mismatchActionError,
  orderNoOf,
  redeliverOutcome,
} from '../display';
import { CloseDialog, type CloseTarget } from '../components/close-dialog';
import { usePermissionCheck } from '@/hooks/use-permission';

export default function ChannelMismatchesTemplate() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const [scope, setScope] = useState<MismatchListScope>('open');
  const list = useMismatches(scope);
  const redeliver = useRedeliverMismatch();
  const close = useCloseMismatch();
  // 다시 배달·종결은 같은 권한이다 — 없으면 행 버튼을 그리지 않는다
  const canWrite = usePermissionCheck().canRun(useRedeliverMismatch);
  const [closeTarget, setCloseTarget] = useState<CloseTarget | null>(null);

  const rows = list.data?.data ?? [];

  // Medusa 예약 대사(#1247) — 멈춘 회차가 있을 때만 크게, 없으면 한 줄
  const runs = useReservationReconcileRuns();
  const applyRun = useApplyReservationRun();
  const closeRun = useCloseReservationRun();
  const canWriteRuns = usePermissionCheck().canRun(useApplyReservationRun);
  const [closeRunTarget, setCloseRunTarget] = useState<CloseTarget | null>(
    null
  );

  const onApplyRun = (id: string) =>
    applyRun.mutateAsync(id).then(
      (run) => {
        const outcome = applyOutcome(run);
        if (outcome.tone === 'success') toast.success(outcome.text);
        else toast.error(outcome.text);
      },
      (e) => toast.error(mismatchActionError(e).text)
    );

  const onCloseRun = (reason: string) => {
    if (!closeRunTarget) return;
    void closeRun.mutateAsync({ id: closeRunTarget.id, reason }).then(
      () => {
        setCloseRunTarget(null);
        toast.success('종결');
      },
      (e) => {
        const failure = mismatchActionError(e);
        if (failure.gone) setCloseRunTarget(null);
        toast.error(failure.text);
      }
    );
  };

  const openRuns = runs.data?.open ?? [];
  const latestLine = latestRunText(runs.data?.latest ?? null);

  // 결과 토스트는 mutateAsync 의 promise 에 건다 — mutate() 쪽 콜백은 다음 호출·언마운트로 유실된다
  const onRedeliver = (id: string) =>
    redeliver.mutateAsync(id).then(
      (result) => {
        const outcome = redeliverOutcome(result);
        if (outcome.tone === 'success') toast.success(outcome.text);
        else toast.error(outcome.text);
      },
      (e) => toast.error(mismatchActionError(e).text)
    );

  const onClose = (memo: string) => {
    if (!closeTarget) return;
    void close.mutateAsync({ id: closeTarget.id, memo }).then(
      () => {
        setCloseTarget(null);
        toast.success('종결');
      },
      (e) => {
        const failure = mismatchActionError(e);
        if (failure.gone) setCloseTarget(null);
        toast.error(failure.text);
      }
    );
  };

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">채널과 어긋남</h1>
        <label className="flex items-center gap-2 text-sm">
          해소·종결 보기
          <Switch
            checked={scope === 'all'}
            onCheckedChange={(on) => setScope(on ? 'all' : 'open')}
          />
        </label>
      </div>

      {runs.isError ? (
        <p className="text-xs text-red-600">
          예약 대사 상태: {loadErrorText(runs.error)}
        </p>
      ) : openRuns.length > 0 ? (
        openRuns.map((run) => {
          const unknown = unknownText(run, now);
          return (
            <section
              key={run.id}
              className="flex flex-col gap-2 rounded-md border border-red-300 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">{haltedRunText(run)}</p>
                {canWriteRuns && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        applyRun.isPending && applyRun.variables === run.id
                      }
                      onClick={() => void onApplyRun(run.id)}
                    >
                      확인했으니 고치기
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setCloseRunTarget({
                          id: run.id,
                          label: haltedRunText(run),
                          maxLength: RUN_REASON_MAX,
                        })
                      }
                    >
                      종결
                    </Button>
                  </div>
                )}
              </div>
              {run.error && (
                <p className="text-xs text-muted-foreground">{run.error}</p>
              )}
              {unknown && (
                <p className="text-xs text-muted-foreground">{unknown}</p>
              )}
              {run.examples.length > 0 && (
                <ul className="font-mono text-xs text-muted-foreground">
                  {run.examples.map((e) => (
                    <li key={e.lineItemId}>{exampleText(e)}</li>
                  ))}
                </ul>
              )}
            </section>
          );
        })
      ) : (
        latestLine && (
          <p className="text-xs text-muted-foreground">
            Medusa 예약 대사 · {latestLine}
          </p>
        )
      )}

      {list.isError ? (
        <p className="text-sm text-red-600">{loadErrorText(list.error)}</p>
      ) : list.isPending ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText(scope)}</p>
      ) : (
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-40" />
            <col className="w-28" />
            <col className="w-24" />
            <col className="w-14" />
            <col />
            <col className="w-56" />
            <col className="w-44" />
          </colgroup>
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1">주문번호</th>
              <th>종류</th>
              <th>첫 발견</th>
              <th>시도</th>
              <th>처리</th>
              <th>마지막 결과</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id} className="border-t">
                <td
                  className="truncate py-1.5 font-mono text-xs"
                  title={f.externalOrderId}
                >
                  {orderNoOf(f)}
                </td>
                <td>{kindLabel(f.kind)}</td>
                <td title={new Date(f.firstSeenAt).toLocaleString('ko-KR')}>
                  {firstSeenText(f.firstSeenAt, now)}
                </td>
                <td className="tabular-nums">{f.attemptCount || ''}</td>
                <td className="truncate" title={handlingText(f)}>
                  {handlingText(f)}
                </td>
                <td className="truncate" title={f.lastResult ?? undefined}>
                  {lastResultText(f.lastResult)}
                </td>
                <td className="text-right">
                  {canWrite && canAct(f) && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          redeliver.isPending && redeliver.variables === f.id
                        }
                        onClick={() => void onRedeliver(f.id)}
                      >
                        다시 배달
                      </Button>{' '}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setCloseTarget({
                            id: f.id,
                            label: `${orderNoOf(f)} · ${kindLabel(f.kind)}`,
                          })
                        }
                      >
                        종결
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {list.data?.truncated && (
        <p className="text-xs text-muted-foreground">
          앞 {rows.length}건만 보입니다
        </p>
      )}

      <CloseDialog
        target={closeRunTarget}
        pending={closeRun.isPending}
        onClose={() => setCloseRunTarget(null)}
        onSubmit={onCloseRun}
      />
      <CloseDialog
        target={closeTarget}
        pending={close.isPending}
        onClose={() => setCloseTarget(null)}
        onSubmit={onClose}
      />
    </div>
  );
}
