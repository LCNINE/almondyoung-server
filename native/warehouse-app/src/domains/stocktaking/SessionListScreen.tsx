import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
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

const STATUS_CLASS: Record<StocktakingStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-400',
};

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
        <ScreenHeader title="실사" backTo="/" />
        <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
          <p className="text-sm text-gray-600">창고를 먼저 선택해 주세요.</p>
          <WarehousePicker />
        </div>
      </div>
    );
  }

  const list = sessions.data?.data ?? [];

  return (
    <div className="space-y-4">
      <ScreenHeader title="실사" backTo="/" />

      {creating ? (
        <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
          <label htmlFor="session-name" className="block text-sm font-medium text-gray-700">
            실사 이름
          </label>
          <input
            id="session-name"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              className="flex-1 border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
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
      ) : (
        <Button type="button" className="w-full py-3" onClick={() => setCreating(true)}>
          + 새 실사
        </Button>
      )}

      {sessions.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(sessions.error, 'stocktaking')}
        </p>
      ) : null}
      {create.isError || start.isError || cancel.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(create.error ?? start.error ?? cancel.error, 'stocktaking')}
        </p>
      ) : null}

      {sessions.isLoading ? <p className="text-sm text-gray-500">불러오는 중…</p> : null}

      {!sessions.isLoading && list.length === 0 ? (
        <p className="text-sm text-gray-500">이 창고에 실사 기록이 없어요.</p>
      ) : null}

      <ul className="space-y-2">
        {list.map((s) => (
          <li key={s.id} className="rounded-lg border border-gray-200 bg-white">
            <button
              type="button"
              className="flex w-full items-center gap-3 p-3 text-left active:bg-gray-50"
              onClick={() => void open(s)}
            >
              <span className="flex-1">
                <span className="block font-semibold text-gray-800">{s.sessionName}</span>
                <span className="block text-xs text-gray-500">
                  {new Date(s.createdAt).toLocaleDateString('ko-KR')}
                </span>
              </span>
              <span
                className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_CLASS[s.status])}
              >
                {STATUS_LABEL[s.status]}
              </span>
            </button>
            {s.status === 'in_progress' ? (
              <div className="border-t border-gray-100 px-3 py-2 text-right">
                <button
                  type="button"
                  className="text-xs text-red-600 underline"
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
