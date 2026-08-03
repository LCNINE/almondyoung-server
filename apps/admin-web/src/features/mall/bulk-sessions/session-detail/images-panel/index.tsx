// src/features/mall/bulk-sessions/session-detail/images-panel/index.tsx
// 세션이 awaiting_images 인 동안 작업자가 워크북이 요구한 이미지 파일을 올리는 패널.

'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { useBulkSessionImages } from '@/lib/services/products/bulk-session';
import type {
  BulkImageUsage,
  BulkSessionProgress,
} from '@/lib/types/dto/bulk-session';
import { Dropzone } from './dropzone';
import { useImageUploader } from './use-image-uploader';

/**
 * 요구 목록 조회 상한. 서버 라우트가 실제로 허용하는 최댓값과 같다
 * (bulk-session.controller.ts 의 `parseImageLimit` 이 1000 으로 clamp 한다).
 *
 * 그래도 한 세션이 이 값을 넘는 필수 이미지를 요구할 수 있다 — reader 는 세션당
 * 최대 10,000행까지 받는다(bulk-session.reader.ts). 1000 을 넘는 나머지는 여기서
 * 페이지네이션하지 않고, 대신 `isTruncated` 로 잘렸음을 화면에 드러낸다: 매칭이
 * 로드된 페이지 안에서만 벌어지므로, 잘린 상태에서 "요구 목록에 없어 건너뛴 파일"
 * 이라고 단정하면 실제로는 다음 페이지에 있는(즉 필요한) 파일까지 "불필요"라고
 * 거짓 안내하게 된다.
 */
const REQUIRED_PAGE_SIZE = 1000;

const USAGE_LABEL: Record<BulkImageUsage, string> = {
  main: '메인',
  description: '상세설명',
};

// `progress` 는 형제 패널(ReviewPanel·WorkingPanel)과 호출부 시그니처를 맞추기 위한
// 계약이다 — 이 패널은 게이트 값을 useBulkSessionImages 응답에서 직접 읽어 쓰지 않는다.
export function ImagesPanel({
  sessionId,
}: {
  sessionId: string;
  progress: BulkSessionProgress;
}) {
  const imagesQuery = useBulkSessionImages(sessionId, {
    onlyRequired: true,
    status: 'awaiting_upload',
    page: 1,
    limit: REQUIRED_PAGE_SIZE,
  });
  const { state, run, retryFailed } = useImageUploader(sessionId);

  // 업로드 중 이탈해도 이미 올라간 것은 서버에 남는다 — 남은 것만 다시 떨구면 된다.
  useEffect(() => {
    if (!state.running) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state.running]);

  // duplicateNames 는 드롭 한 번마다 matchFilesToImageRows 가 새로 만든 배열이라, 드롭이
  // 일어난 시점에만 레퍼런스가 바뀐다 — 토스트가 드롭당 정확히 한 번만 뜬다.
  useEffect(() => {
    if (state.duplicateNames.length === 0) return;
    toast.warning(
      `같은 이름의 파일이 ${state.duplicateNames.length}건 있습니다. 마지막 파일이 사용됩니다.`
    );
  }, [state.duplicateNames]);

  function notifyIfDrafting(phase: Awaited<ReturnType<typeof run>>) {
    if (phase === 'drafting') {
      toast.success('이미지가 모두 준비돼 임시 버전 생성을 시작합니다.');
    }
    // 패널 전환 자체는 훅의 setQueryData 가 이미 처리한다 — 여기서는 알림만 띄운다.
  }

  async function handleFiles(files: File[]) {
    const rows = imagesQuery.data?.data ?? [];
    notifyIfDrafting(await run(files, rows));
  }

  async function handleRetry() {
    notifyIfDrafting(await retryFailed());
  }

  const requiredTotal = imagesQuery.data?.requiredTotal ?? 0;
  const requiredResolved = imagesQuery.data?.requiredResolved ?? 0;
  const gatePercent =
    requiredTotal > 0
      ? Math.round((requiredResolved / requiredTotal) * 100)
      : 0;
  const rows = imagesQuery.data?.data ?? [];
  // total 은 (필수 + 미업로드) 행의 전체 개수다 — 그게 REQUIRED_PAGE_SIZE 를 넘으면
  // 이번 페이지가 목록 전체가 아니다. 매칭도 이 페이지 안에서만 벌어지므로, 잘렸을 땐
  // "요구 목록에 없다"는 판정 자체를 못 믿는다.
  const isTruncated = (imagesQuery.data?.total ?? 0) > rows.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium">필수 이미지 업로드</p>
          <p className="text-sm text-muted-foreground">
            {requiredResolved} / {requiredTotal}건
          </p>
        </div>
        <Progress value={gatePercent} className="mt-3" />
      </div>

      {isTruncated && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
          목록이 너무 커서 아래 {rows.length}건만 불러왔습니다(전체{' '}
          {imagesQuery.data?.total ?? 0}건). 나머지는 이 화면에 보이지 않을 뿐
          여전히 필요한 파일입니다 — 아래 목록에 없다고 해서 그 파일을
          건너뛰어도 되는 것은 아닙니다.
        </div>
      )}

      <Dropzone
        onFiles={(files) => {
          void handleFiles(files);
        }}
        disabled={state.running}
      />

      {state.running && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" />
          업로드 중입니다… {state.done} / {state.total}
        </div>
      )}

      {state.unmatchedFiles.length > 0 && (
        <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            {isTruncated
              ? `요구 목록에서 확인하지 못한 파일 ${state.unmatchedFiles.length}건`
              : `요구 목록에 없어 건너뛴 파일 ${state.unmatchedFiles.length}건`}
          </p>
          {isTruncated && (
            <p className="mt-1">
              목록이 잘려 있어 이 파일들이 실제로 불필요한지 확인할 수 없습니다.
              필요 없는 파일인지 다시 확인해 주세요.
            </p>
          )}
          <ul className="mt-1 list-disc pl-5">
            {state.unmatchedFiles.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      )}

      {state.failed.length > 0 && (
        <div className="rounded-md border border-destructive/50 p-3">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-destructive">
              업로드 실패 {state.failed.length}건
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={state.running}
              onClick={() => {
                void handleRetry();
              }}
            >
              실패한 것만 다시 시도
            </Button>
          </div>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {state.failed.map((f) => (
              <li key={`${f.imageKey} ${f.usage}`}>
                {f.fileName} · {USAGE_LABEL[f.usage]} — {f.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg border">
        <div className="border-b px-3 py-2 text-sm font-medium">
          올려야 하는 파일
        </div>
        {imagesQuery.isPending && (
          <p className="p-3 text-sm text-muted-foreground">
            불러오는 중입니다…
          </p>
        )}
        {imagesQuery.isError && (
          <p role="alert" className="p-3 text-sm text-destructive">
            목록을 불러오지 못했습니다.
          </p>
        )}
        {imagesQuery.data && rows.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">
            필요한 이미지를 모두 받았습니다.
          </p>
        )}
        {rows.length > 0 && (
          <ul className="divide-y text-sm">
            {rows.map((row) => (
              <li
                key={`${row.imageKey} ${row.usage}`}
                className="flex items-center justify-between px-3 py-2"
              >
                <span>{row.sourceValue}</span>
                <span className="text-muted-foreground">
                  {USAGE_LABEL[row.usage]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
