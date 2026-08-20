// src/features/mall/bulk-sessions/session-detail/images-panel/index.tsx
// 세션이 awaiting_images 인 동안 작업자가 워크북이 요구한 이미지 파일을 올리는 패널.

'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { useBulkSessionRequiredImages } from '@/lib/services/products/bulk-session';
import type {
  BulkImageUsage,
  BulkSessionProgress,
} from '@/lib/types/dto/bulk-session';
import { Dropzone } from './dropzone';
import { useImageUploader } from './use-image-uploader';

/**
 * 목록에 그리는 행 수 상한. 매칭은 전량 rows 로 하므로 표시만 줄인다 — 세션이
 * 1만 행(파싱 상한)을 요구할 수 있고, 그걸 다 그리면 화면이 무거워진다.
 */
const DISPLAY_LIMIT = 500;

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
  const imagesQuery = useBulkSessionRequiredImages(sessionId);
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
    // 전량 rows 를 그대로 넘긴다 — required·awaiting 거름은 matchFilesToImageRows 가 한다.
    const rows = imagesQuery.data?.rows ?? [];
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
  const awaiting = (imagesQuery.data?.rows ?? []).filter(
    (row) => row.status === 'awaiting_upload'
  );
  const visible = awaiting.slice(0, DISPLAY_LIMIT);

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

      <Dropzone
        onFiles={(files) => {
          void handleFiles(files);
        }}
        // 목록이 아직 없으면 매칭 근거가 없어 전부 "요구 목록에 없다"로 오판한다 —
        // 로드 중·실패 상태에서는 받지 않는다(아래 목록 카드가 상태를 보여준다).
        disabled={state.running || !imagesQuery.data}
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
            요구 목록에 없어 건너뛴 파일 {state.unmatchedFiles.length}건
          </p>
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
        {imagesQuery.data && awaiting.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">
            필요한 이미지를 모두 받았습니다.
          </p>
        )}
        {awaiting.length > 0 && (
          <ul className="divide-y text-sm">
            {visible.map((row) => (
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
        {awaiting.length > visible.length && (
          <p className="border-t px-3 py-2 text-sm text-muted-foreground">
            …외 {awaiting.length - visible.length}건. 파일을 떨구면 목록에 없는
            것까지 전부 매칭됩니다.
          </p>
        )}
      </div>
    </div>
  );
}
