import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { isStationDevice } from '../../app/station';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { ConfirmDialog } from '../../core/design/ConfirmDialog';
import { cn } from '../../core/design/cn';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { useStocktakingSessions } from './queries';
import { useCreateSession, useStartSession, useCancelSession } from './mutations';
import type { StocktakingSession, StocktakingStatus } from './types';

const STATUS_LABEL: Record<StocktakingStatus, string> = {
  draft: '대기',
  in_progress: '진행중',
  completed: '완료',
  cancelled: '취소됨',
};

const DESCRIPTION = '실물 수량을 입력하고 장부와의 차이를 검토하세요.';

const STATUS_CLASS: Record<StocktakingStatus, string> = {
  draft: 'bg-[#f4f4f5] text-[#71717a]',
  in_progress: 'bg-[#eff6ff] text-[#2563eb]',
  completed: 'bg-[#edf7ed] text-[#2f7a3b]',
  cancelled: 'bg-[#f4f4f5] text-[#8b8b95]',
};

const PANEL = 'rounded-xl border border-[#e4e4e7] bg-white';
const OUTLINE_BUTTON =
  'border border-[#e4e4e7] bg-white text-[#27272a] hover:bg-[#eff6ff] hover:brightness-100';

/** 오늘 날짜를 기본 세션명으로. 현장에서 타이핑을 최소화한다. */
function defaultSessionName(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} 실사`;
}

export function SessionListScreen() {
  const navigate = useNavigate();
  const station = isStationDevice();
  const { warehouseId, isSet } = useWarehouse();
  const sessions = useStocktakingSessions(warehouseId);
  const create = useCreateSession();
  const start = useStartSession();
  const cancel = useCancelSession();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState(defaultSessionName);
  const [cancelTarget, setCancelTarget] = useState<StocktakingSession | null>(null);

  function goToSession(sessionId: string) {
    void navigate({ to: '/stocktaking/$sessionId', params: { sessionId } });
  }

  async function open(s: StocktakingSession) {
    if (s.status === 'draft') {
      await start.mutateAsync(s.id);
    }
    goToSession(s.id);
  }

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="실사" description={DESCRIPTION} backTo="/" />
        <div className="space-y-3 rounded-xl border border-dashed border-[#e4e4e7] bg-white p-4">
          <p className="text-sm text-[#71717a]">창고를 먼저 선택해 주세요.</p>
          <WarehousePicker />
        </div>
      </div>
    );
  }

  const list = sessions.data?.data ?? [];
  const newSessionButton = (
    <Button type="button" className={station ? undefined : 'w-full py-3'} onClick={() => setCreating(true)}>
      + 새 실사
    </Button>
  );

  return (
    <div className="space-y-4">
      <ScreenHeader
        title="실사"
        description={DESCRIPTION}
        backTo="/"
        right={station && !creating ? newSessionButton : undefined}
      />

      {creating ? (
        <div className="space-y-2 rounded-xl border border-[#e4e4e7] bg-white p-4">
          <label htmlFor="session-name" className="block text-sm font-medium text-[#27272a]">
            실사 이름
          </label>
          <input
            id="session-name"
            className="w-full rounded-lg border border-[#e4e4e7] bg-white px-3 py-2.5 text-sm text-[#27272a]"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              className={cn('flex-1', OUTLINE_BUTTON)}
              onClick={() => setCreating(false)}
            >
              그만두기
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={newName.trim().length === 0 || create.isPending || start.isPending}
              onClick={async () => {
                if (!warehouseId) return;
                const created = await create.mutateAsync({
                  warehouseId,
                  sessionName: newName.trim(),
                });
                await start.mutateAsync(created.id);
                setCreating(false);
                goToSession(created.id);
              }}
            >
              시작
            </Button>
          </div>
        </div>
      ) : station ? null : (
        newSessionButton
      )}

      {sessions.isError ? (
        <p role="alert" className="text-sm text-[#aa4037]">
          {errorMessage(sessions.error, 'stocktaking')}
        </p>
      ) : null}
      {create.isError || start.isError || cancel.isError ? (
        <p role="alert" className="text-sm text-[#aa4037]">
          {errorMessage(create.error ?? start.error ?? cancel.error, 'stocktaking')}
        </p>
      ) : null}

      {sessions.isLoading ? <p className="text-sm text-[#71717a]">불러오는 중…</p> : null}

      {!sessions.isLoading && list.length === 0 ? (
        <p className="text-sm text-[#71717a]">이 창고에 실사 기록이 없어요.</p>
      ) : null}

      <ul className="space-y-2">
        {list.map((s) => (
          <li key={s.id} className={PANEL}>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-xl p-4 text-left hover:bg-[#eff6ff]"
              onClick={() => void open(s)}
            >
              <span className="flex-1">
                <span className="block font-semibold text-[#27272a]">{s.sessionName}</span>
                <span className="block text-xs text-[#71717a]">
                  {new Date(s.createdAt).toLocaleDateString('ko-KR')}
                </span>
              </span>
              <span
                className={cn(
                  'inline-flex items-center rounded-[5px] px-2 py-[5px] text-[11px] font-semibold whitespace-nowrap',
                  STATUS_CLASS[s.status]
                )}
              >
                {STATUS_LABEL[s.status]}
              </span>
            </button>
            {s.status === 'in_progress' ? (
              <div className="border-t border-[#e4e4e7] px-4 py-2 text-right">
                <button
                  type="button"
                  className="text-xs text-[#aa4037] underline"
                  onClick={() => setCancelTarget(s)}
                >
                  {s.sessionName} 취소
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={cancelTarget !== null}
        title="실사 취소"
        message={`"${cancelTarget?.sessionName ?? ''}" 실사를 취소합니다. 센 수량은 원장에 반영되지 않아요.`}
        confirmLabel="실사 취소"
        danger
        onCancel={() => setCancelTarget(null)}
        onConfirm={() => {
          const target = cancelTarget;
          setCancelTarget(null);
          if (target) cancel.mutate(target.id);
        }}
      />
    </div>
  );
}
