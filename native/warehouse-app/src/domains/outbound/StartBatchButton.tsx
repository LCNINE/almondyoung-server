import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import {
  excludeBlockedAndStart,
  groupStartBlockers,
  isEmptyBatchError,
  startBatch,
  startBlockersOf,
  type SkippedBlocker,
  type StartBlocker,
} from './batchStart';

const EMPTY_AFTER_REMOVE = '막힌 박스를 모두 뺐어요. 배치에 남은 박스가 없어요 — 뺀 박스는 관리자 화면 출고 준비로 돌아가요.';

/**
 * 배치 카드의 「작업 시작」(스펙 E6). 이 버튼만 배치를 시작한다 — 시작되면 재고 통제와 배정이 확정되고,
 * 그 뒤에만 「송장 인쇄」가 켜진다. 막히면 막힌 박스를 사유별로 전부 보여 주고(E7), 그 박스만 빼고 시작할 수 있다.
 * 시작되면 이 버튼은 인쇄 버튼으로 바뀌어 사라지므로, 뺀 박스 수는 `onStarted` 로 넘겨 화면이 알린다.
 */
export function StartBatchButton({
  batchId,
  onStarted,
  label = '작업 시작',
}: {
  batchId: string;
  onStarted?: (outcome: RemovedOnStart) => void;
  /** 시작 뒤 이어서 할 일까지 하는 화면이 이름을 바꾼다(「작업 시작하고 송장 인쇄」) */
  label?: string;
}) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [blockers, setBlockers] = useState<StartBlocker[] | null>(null);
  const [skipped, setSkipped] = useState<SkippedBlocker[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // 빼고 다시 시작했는데 또 막히면 뺀 박스 수를 들고 있다가 끝내 시작될 때 함께 알린다
  const [removedSoFar, setRemovedSoFar] = useState<RemovalLog>(EMPTY_LOG);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['outbound-batches'] }),
      queryClient.invalidateQueries({ queryKey: ['batch-work-items', batchId] }),
      queryClient.invalidateQueries({ queryKey: ['waybill-label-states', batchId] }),
    ]);

  const showFailure = (error: unknown) => {
    const found = startBlockersOf(error);
    setBlockers(found);
    setNotice(found ? null : isEmptyBatchError(error) ? EMPTY_AFTER_REMOVE : errorMessage(error, 'outbound'));
  };

  const start = useMutation({
    mutationFn: () => startBatch(api, batchId, crypto.randomUUID()),
    onSuccess: async () => {
      setBlockers(null);
      setSkipped([]);
      setNotice(null);
      setRemovedSoFar(EMPTY_LOG);
      await refresh();
      onStarted?.(outcomeOf(removedSoFar));
    },
    onError: (error) => {
      setSkipped([]);
      showFailure(error);
    },
  });

  const removeAndStart = useMutation({
    mutationFn: (current: readonly StartBlocker[]) =>
      excludeBlockedAndStart({ api, newKey: () => crypto.randomUUID() }, batchId, current),
    onSuccess: async ({ removedIds, skipped: notRemoved, start: attempt }) => {
      await refresh();
      const total = mergeLog(removedSoFar, removedIds, notRemoved);
      if (attempt.kind === 'failed') {
        setRemovedSoFar(total);
        setSkipped(notRemoved);
        showFailure(attempt.error);
        return;
      }
      setBlockers(null);
      setSkipped([]);
      setNotice(null);
      setRemovedSoFar(EMPTY_LOG);
      onStarted?.(outcomeOf(total));
    },
    onError: (error) => {
      setSkipped([]);
      setBlockers(null);
      setNotice(errorMessage(error, 'outbound'));
    },
  });

  const busy = start.isPending || removeAndStart.isPending;
  const groups = blockers ? groupStartBlockers(blockers) : null;
  const boxCount = blockers ? new Set(blockers.map((b) => b.shipmentId)).size : 0;

  return (
    <div className="space-y-2">
      <Button onClick={() => start.mutate()} disabled={busy}>
        {label}
      </Button>
      {notice !== null && <p role="alert">{notice}</p>}
      {groups !== null && blockers !== null && (
        <section role="alert" className="space-y-2 rounded border border-red-300 px-3 py-2">
          <p className="font-medium">시작하지 못했어요 — 아래 박스를 먼저 처리해 주세요</p>
          {groups.map((group) => (
            <div key={group.reason}>
              <p className="text-sm font-medium">{group.title}</p>
              <ul className="text-sm">
                {group.rows.map((row, index) => (
                  <li key={`${index}-${row}`}>{row}</li>
                ))}
              </ul>
              <p className="text-sm text-neutral-500">{group.guidance}</p>
            </div>
          ))}
          {removedSoFar.removed.size > 0 && (
            <p className="text-sm">이미 뺀 박스 {removedSoFar.removed.size}개는 관리자 화면 출고 준비로 돌아갔어요.</p>
          )}
          {skipped.length > 0 && (
            <ul className="text-sm text-red-700">
              {skipped.map((item) => (
                <li key={item.label}>
                  {item.label} — 빼지 못했어요: {item.message}
                </li>
              ))}
            </ul>
          )}
          <Button className="bg-red-600 hover:bg-red-700" onClick={() => removeAndStart.mutate(blockers)} disabled={busy}>
            막힌 박스 {boxCount}개 빼고 나머지로 시작
          </Button>
          <p className="text-sm text-neutral-500">뺀 박스는 관리자 화면 출고 준비로 돌아가요. 처리한 뒤 다시 출고 준비하면 돼요.</p>
        </section>
      )}
    </div>
  );
}

export interface RemovedOnStart {
  removed: number;
  /** 빼기 결과를 모르는 박스 수 */
  uncertain: number;
}

/** 빼고 다시 시작하기를 여러 번 했을 때 상자별로 모은다 — 결과를 몰랐던 상자가 다음에 빠지면 확인할 일에서 지운다 */
interface RemovalLog {
  removed: ReadonlySet<string>;
  uncertain: ReadonlySet<string>;
}

const EMPTY_LOG: RemovalLog = { removed: new Set(), uncertain: new Set() };

function mergeLog(log: RemovalLog, removedIds: readonly string[], skipped: readonly SkippedBlocker[]): RemovalLog {
  const removed = new Set([...log.removed, ...removedIds]);
  const uncertain = new Set([...log.uncertain, ...skipped.filter((item) => item.uncertain).map((item) => item.shipmentId)]);
  for (const id of removed) uncertain.delete(id);
  return { removed, uncertain };
}

function outcomeOf(log: RemovalLog): RemovedOnStart {
  return { removed: log.removed.size, uncertain: log.uncertain.size };
}

/** 막힌 박스를 빼고 시작한 뒤 배치 화면에 남기는 안내 */
export function RemovedOnStartNotice({ outcome }: { outcome: RemovedOnStart }) {
  if (outcome.removed <= 0 && outcome.uncertain <= 0) return null;
  return (
    <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {outcome.removed > 0 &&
        `막힌 박스 ${outcome.removed}개를 빼고 시작했어요. 뺀 박스는 관리자 화면 출고 준비로 돌아가요.`}
      {outcome.removed > 0 && outcome.uncertain > 0 && ' '}
      {outcome.uncertain > 0 &&
        `박스 ${outcome.uncertain}개는 빠졌는지 확인하지 못했어요 — 배치 박스 목록에서 확인해 주세요.`}
    </p>
  );
}
