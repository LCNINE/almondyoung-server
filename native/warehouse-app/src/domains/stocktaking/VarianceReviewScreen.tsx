import { WorkArea } from '../../core/operations/WorkBoundary';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { ConfirmDialog } from '../../core/design/ConfirmDialog';
import { cn } from '../../core/design/cn';
import { useStocktakingSession, useStocktakingVariances } from './queries';
import { useGenerateAdjustments, useCompleteSession } from './mutations';
import type { AdjustmentPreview } from './types';

function VarianceReviewScreenContent({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  const detail = useStocktakingSession(sessionId);
  const variances = useStocktakingVariances(sessionId);
  const generate = useGenerateAdjustments();
  const complete = useCompleteSession();

  const [preview, setPreview] = useState<AdjustmentPreview[] | null>(null);
  const [approval, setApproval] = useState<{
    token: string;
    signature: string;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const editable = detail.data?.status === 'in_progress';
  const rows = variances.data ?? [];
  // 캐시가 무효화됐거나(다른 화면에서 카운트가 바뀜) 재조회 중이면, rows 가
  // 비어 있어도 그건 "차이 없음"이 아니라 "아직 확인 못함"이다 — 완료를 열면
  // 안 된다(FIX 1: 미리보기 게이트가 스테일 캐시에 fail-open 하던 버그).
  const noVariance =
    variances.isSuccess &&
    !variances.isStale &&
    !variances.isFetching &&
    rows.length === 0;
  const signature = JSON.stringify([
    detail.data?.sessionRevision,
    detail.data?.lines,
    rows,
  ]);
  const fresh =
    detail.isSuccess &&
    !detail.isFetching &&
    variances.isSuccess &&
    !variances.isStale &&
    !variances.isFetching;
  const canComplete =
    editable && fresh && !!approval?.token && approval.signature === signature;
  useEffect(() => {
    if (!fresh || approval?.signature !== signature) {
      setPreview(null);
      setApproval(null);
      setConfirming(false);
    }
  }, [fresh, signature]);
  async function review() {
    setPreview(null);
    setApproval(null);
    const reviewedSignature = signature;
    try {
      const result = await generate.mutateAsync(sessionId);
      if (!result.previewToken) return;
      setPreview(result.preview);
      setApproval({ token: result.previewToken, signature: reviewedSignature });
    } catch {
      /* Domain message below explains why review is unavailable. */
    }
  }
  const autoReview = useRef('');
  useEffect(() => {
    const key = `${signature}:${detail.dataUpdatedAt}:${variances.dataUpdatedAt}`;
    if (autoReview.current === key) return;
    if (
      noVariance &&
      editable &&
      fresh &&
      !approval &&
      !generate.isPending &&
      !generate.isError
    ) {
      autoReview.current = key;
      void review();
    }
  }, [
    noVariance,
    editable,
    fresh,
    signature,
    approval,
    generate.isPending,
    generate.isError,
  ]);

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

      {variances.isLoading ? (
        <p className="text-sm text-gray-500">불러오는 중…</p>
      ) : null}

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
                <span className="block font-medium text-gray-800">
                  {v.skuName}
                </span>
                <span className="block text-xs text-gray-500">
                  <span>{v.locationCode ?? '위치 미지정'}</span> · {v.skuCode}
                </span>
              </span>
              <span className="text-center">
                <span className="block text-xs text-gray-500">예상</span>
                <span className="block text-sm text-gray-700">
                  {v.expectedQuantity}
                </span>
              </span>
              <span className="text-center">
                <span className="block text-xs text-gray-500">카운트</span>
                <span className="block text-sm text-gray-700">
                  {v.countedQuantity ?? '—'}
                </span>
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
          disabled={generate.isPending || !fresh}
          onClick={() => void review()}
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
          if (!canComplete || !approval) return;
          complete.mutate(
            { sessionId, previewToken: approval.token },
            {
              onSuccess: () => void navigate({ to: '/stocktaking' }),
            }
          );
        }}
      />
    </div>
  );
}

export function VarianceReviewScreen(
  props: Parameters<typeof VarianceReviewScreenContent>[0]
) {
  return (
    <WorkArea kind="stocktaking">
      <VarianceReviewScreenContent {...props} />
    </WorkArea>
  );
}
