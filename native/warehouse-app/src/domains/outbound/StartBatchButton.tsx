import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { groupStartBlockers, startBatch, startBlockersOf, type BlockerGroup } from './batchStart';

/**
 * 배치 카드의 「작업 시작」(스펙 E6). 이 버튼만 배치를 시작한다 — 시작되면 재고 통제와 배정이 확정되고,
 * 그 뒤에만 「송장 인쇄」가 켜진다. 막히면 막힌 박스를 사유별로 전부 보여 준다(E7).
 */
export function StartBatchButton({ batchId, onStarted }: { batchId: string; onStarted?: () => void }) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [groups, setGroups] = useState<BlockerGroup[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () => startBatch(api, batchId, crypto.randomUUID()),
    onSuccess: async () => {
      setGroups(null);
      setNotice(null);
      await queryClient.invalidateQueries({ queryKey: ['outbound-batches'] });
      onStarted?.();
    },
    onError: (error) => {
      const blockers = startBlockersOf(error);
      if (blockers) {
        setGroups(groupStartBlockers(blockers));
        setNotice(null);
      } else {
        setGroups(null);
        setNotice(errorMessage(error, 'outbound'));
      }
    },
  });
  return (
    <div className="space-y-2">
      <Button onClick={() => start.mutate()} disabled={start.isPending}>
        작업 시작
      </Button>
      {notice !== null && <p role="alert">{notice}</p>}
      {groups !== null && (
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
        </section>
      )}
    </div>
  );
}
