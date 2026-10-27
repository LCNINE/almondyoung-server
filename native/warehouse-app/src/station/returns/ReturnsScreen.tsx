import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWarehouse } from '../../app/warehouse-context';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { cn } from '../../core/design/cn';
import { fetchReturn } from '../../domains/customer-returns/api';
import { receivingStageOf } from '../../domains/customer-returns/stage';
import type { ReturnView } from '../../domains/customer-returns/types';
import { WarehousePicker } from '../../domains/warehouse/WarehousePicker';
import { useStationActions } from '../ActionRegistry';
import { useFeedback } from '../feedback/FeedbackProvider';
import { ReturnList } from './ReturnList';
import { RETURNS_ACTIONS } from './returnsActions';

/** 화면 상태 — 목록 → (열기) → 소포 세기 또는 검수(N8) */
export type ReturnsView = { kind: 'list' } | { kind: 'receive'; view: ReturnView } | { kind: 'inspect'; view: ReturnView };

/** 목록 위 한 줄 — error 는 오류음과 함께 */
export interface ReturnsNotice {
  text: string;
  tone: 'error' | 'info';
}

const CLOSED_MESSAGE = { cancelled: '취소된 반품이에요', inspected: '끝난 반품이에요' } as const;

/** 스테이션 F7 반품 — 고객 반품의 도착·검수 */
export function ReturnsScreen() {
  const { warehouseId } = useWarehouse();
  if (!warehouseId) return <WarehousePicker />;
  return <Returns key={warehouseId} warehouseId={warehouseId} />;
}

function Returns({ warehouseId }: { warehouseId: string }) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { signal } = useFeedback();
  const [current, setCurrent] = useState<ReturnsView>({ kind: 'list' });
  const [notice, setNotice] = useState<ReturnsNotice | null>(null);
  // 상세를 읽는 중 — 겹친 열기(연속 Enter·스캔)는 버린다
  const opening = useRef(false);

  const say = useCallback(
    (next: ReturnsNotice | null) => {
      setNotice(next);
      if (next?.tone === 'error') signal('error');
    },
    [signal]
  );

  /** 목록으로 — 목록은 다시 읽는다(그 사이 바뀐 단계·사라진 반품) */
  const toList = useCallback(
    (next: ReturnsNotice | null = null) => {
      setCurrent({ kind: 'list' });
      say(next);
      void queryClient.invalidateQueries({ queryKey: ['customer-return-receiving'] });
    },
    [queryClient, say]
  );

  /** 상세를 읽고 단계대로 연다 — 끝난 반품이면 한 줄 안내 뒤 목록(N8·N10) */
  const open = useCallback(
    async (id: string) => {
      if (opening.current) return;
      opening.current = true;
      try {
        const view = await fetchReturn(api, id);
        const stage = receivingStageOf(view);
        if (stage.kind === 'closed') {
          toList({ text: CLOSED_MESSAGE[stage.reason], tone: 'error' });
          return;
        }
        setNotice(null);
        setCurrent({ kind: stage.kind, view });
      } catch (error) {
        say({ text: errorMessage(error), tone: 'error' });
      } finally {
        opening.current = false;
      }
    },
    [api, toList, say]
  );
  const openFromList = useCallback((id: string) => void open(id), [open]);
  const clearNotice = useCallback(() => setNotice(null), []);

  switch (current.kind) {
    // Task 5·6 이 소포 세기·검수 화면으로 채운다
    case 'receive':
      return <ReturnPlaceholder label="소포 세기" view={current.view} onBack={() => toList()} />;
    case 'inspect':
      return <ReturnPlaceholder label="검수" view={current.view} onBack={() => toList()} />;
    default:
      return (
        <div className="flex h-full min-h-0 flex-col gap-3">
          {notice ? (
            <p
              role={notice.tone === 'error' ? 'alert' : 'status'}
              className={cn(
                'shrink-0 rounded-[10px] px-4 py-3 text-lg font-semibold',
                notice.tone === 'error' ? 'bg-[#FDE8EA] text-[#9E1320]' : 'bg-[#E3ECFC] text-[#123E99]'
              )}
            >
              {notice.text}
            </p>
          ) : null}
          <ReturnList warehouseId={warehouseId} onOpen={openFromList} onActivity={clearNotice} />
        </div>
      );
  }
}

function ReturnPlaceholder({ label, view, onBack }: { label: string; view: ReturnView; onBack(): void }) {
  useStationActions([{ ...RETURNS_ACTIONS.back, enabled: true, run: onBack }]);
  return (
    <section aria-label={label} className="rounded-[10px] border border-[#D5D8DE] bg-white p-4">
      <h2 className="font-mono text-2xl font-semibold">{view.order.orderNo}</h2>
    </section>
  );
}
