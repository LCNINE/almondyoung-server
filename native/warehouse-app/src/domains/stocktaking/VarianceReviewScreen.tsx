import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { ConfirmDialog } from '../../core/design/ConfirmDialog';
import { cn } from '../../core/design/cn';
import { useStocktakingSession, useStocktakingVariances } from './queries';
import { useGenerateAdjustments, useCompleteSession } from './mutations';
import type { AdjustmentPreview } from './types';

export function VarianceReviewScreen({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  const detail = useStocktakingSession(sessionId);
  const variances = useStocktakingVariances(sessionId);
  const generate = useGenerateAdjustments();
  const complete = useCompleteSession();

  const [preview, setPreview] = useState<AdjustmentPreview[] | null>(null);
  const [confirming, setConfirming] = useState(false);

  const editable = detail.data?.status === 'in_progress';
  const rows = variances.data ?? [];
  const noVariance = variances.isSuccess && rows.length === 0;
  // 미리보기를 봤거나, 애초에 적용할 차이가 없을 때만 완료를 연다.
  const canComplete = editable && (preview !== null || noVariance);

  return (
    <div className="space-y-4">
      <ScreenHeader
        title="차이 확인"
        backTo="/stocktaking"
        right={detail.data ? <span>{detail.data.sessionName}</span> : null}
      />

      {variances.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(variances.error, 'stocktaking')}
        </p>
      ) : null}
      {generate.isError || complete.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(generate.error ?? complete.error, 'stocktaking')}
        </p>
      ) : null}

      {variances.isLoading ? <p className="text-sm text-gray-500">불러오는 중…</p> : null}

      {noVariance ? (
        <p className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          차이가 없어요. 적용할 조정이 없습니다.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((v) => (
            <li
              key={v.lineId}
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
            >
              <span className="flex-1">
                <span className="block font-medium text-gray-800">{v.skuName}</span>
                <span className="block text-xs text-gray-500">
                  <span>{v.locationCode ?? '위치 미지정'}</span> · {v.skuCode}
                </span>
              </span>
              <span className="text-center">
                <span className="block text-xs text-gray-500">예상</span>
                <span className="block text-sm text-gray-700">{v.expectedQuantity}</span>
              </span>
              <span className="text-center">
                <span className="block text-xs text-gray-500">카운트</span>
                <span className="block text-sm text-gray-700">{v.countedQuantity ?? '—'}</span>
              </span>
              <span
                data-testid={`variance-${v.lineId}`}
                className={cn(
                  'w-12 text-right text-lg font-semibold',
                  (v.variance ?? 0) > 0 ? 'text-green-700' : 'text-red-600'
                )}
              >
                {(v.variance ?? 0) > 0 ? `+${v.variance}` : v.variance}
              </span>
            </li>
          ))}
        </ul>
      )}

      {editable && !noVariance ? (
        <Button
          type="button"
          className="w-full py-3 border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
          disabled={generate.isPending}
          onClick={async () => {
            try {
              const result = await generate.mutateAsync(sessionId);
              setPreview(result.preview);
            } catch {
              // generate.isError 배너가 이미 메시지를 보여준다 — 여기서는
              // unhandled rejection 만 막는다. 에러 상태 자체는 그대로 둔다.
            }
          }}
        >
          조정 미리보기
        </Button>
      ) : null}

      {preview !== null ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">
            적용될 조정 {preview.length}건
          </h2>
          {preview.length === 0 ? (
            <p className="text-sm text-gray-500">적용할 조정이 없어요.</p>
          ) : (
            <ul className="space-y-1">
              {preview.map((p) => (
                <li
                  key={p.lineId}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm"
                >
                  <span className="flex-1 text-gray-700">
                    현재 {p.currentOnHand} → 카운트 {p.countedQuantity}
                  </span>
                  <span
                    data-testid={`preview-${p.lineId}`}
                    className={cn(
                      'font-semibold',
                      p.delta > 0 ? 'text-green-700' : 'text-red-600'
                    )}
                  >
                    {p.delta > 0 ? `+${p.delta}` : p.delta}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {editable ? (
        <Button
          type="button"
          className="w-full py-3"
          disabled={!canComplete || complete.isPending}
          onClick={() => setConfirming(true)}
        >
          실사 완료 · 원장 적용
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title="실사 완료"
        message={`${preview?.length ?? 0}건의 조정이 원장에 적용돼요. 되돌릴 수 없어요.`}
        confirmLabel="완료"
        danger
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          complete.mutate(sessionId, {
            onSuccess: () => void navigate({ to: '/stocktaking' }),
          });
        }}
      />
    </div>
  );
}
