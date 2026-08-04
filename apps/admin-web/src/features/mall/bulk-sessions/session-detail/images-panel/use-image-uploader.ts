// src/features/mall/bulk-sessions/session-detail/images-panel/use-image-uploader.ts
// 이미지 업로드 오케스트레이션. 순수 판정(매칭·청킹·짝짓기)은 전부
// bulk-session-model.ts(Task 5)가 하고 여기엔 오케스트레이션만 남는다.

'use client';

import { useCallback, useRef, useState } from 'react';
import { uploadFileToFileService } from '@/lib/api/domains/files/upload.client';
import type {
  BulkSessionImage,
  BulkSessionPhase,
  ResolveImageEntry,
} from '@/lib/types/dto/bulk-session';
import {
  chunkResolutions,
  matchFilesToImageRows,
  pairResolveResults,
  type UploadTask,
} from '@/lib/services/products/bulk-session-model';
import { useResolveImages } from '@/lib/services/products/bulk-session';

/** 동시 업로드 상한. 수백 장을 한꺼번에 던지면 브라우저 커넥션 한도와 프록시가 막는다. */
const CONCURRENCY = 5;

export interface FailedUpload {
  imageKey: string;
  usage: BulkSessionImage['usage'];
  fileName: string;
  reason: string;
}

export interface UploaderState {
  running: boolean;
  done: number;
  total: number;
  failed: FailedUpload[];
  unmatchedFiles: string[];
  duplicateNames: string[];
}

const INITIAL: UploaderState = {
  running: false,
  done: 0,
  total: 0,
  failed: [],
  unmatchedFiles: [],
  duplicateNames: [],
};

function reason(error: unknown): string {
  return error instanceof Error ? error.message : '업로드에 실패했습니다.';
}

/**
 * 작업 배열을 고정 개수의 워커로 소진한다.
 *
 * `Promise.all` 로 전부 던지지 않는 이유는 수백 장에서 브라우저 커넥션 한도와 Next
 * 프록시가 막기 때문이다. 인덱스를 공유 커서로 써서 워커가 끝나는 대로 다음 것을 집는다 —
 * 청크로 나눠 배리어를 두는 것보다 느린 파일 하나가 전체를 잡아두지 않는다.
 */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        await worker(items[index]);
      }
    }
  );
  await Promise.all(runners);
}

export function useImageUploader(sessionId: string) {
  const [state, setState] = useState<UploaderState>(INITIAL);
  const resolveImages = useResolveImages(sessionId);
  // 재시도는 같은 파일 핸들을 다시 써야 한다. 브라우저가 경로를 돌려주지 않으므로
  // 사용자가 떨군 File 객체를 들고 있는 것이 유일한 방법이다.
  const lastTasksRef = useRef<UploadTask<File>[]>([]);

  const runTasks = useCallback(
    async (tasks: UploadTask<File>[]): Promise<BulkSessionPhase | null> => {
      lastTasksRef.current = tasks;
      setState((prev) => ({
        ...prev,
        running: true,
        done: 0,
        total: tasks.length,
        failed: [],
      }));

      const entries: ResolveImageEntry[] = [];
      const failed: FailedUpload[] = [];

      await runPool(tasks, CONCURRENCY, async (task) => {
        try {
          const uploaded = await uploadFileToFileService(task.file, {
            contextId: task.contextId,
          });
          entries.push({
            imageKey: task.imageKey,
            usage: task.usage,
            fileId: uploaded.id,
          });
        } catch (error) {
          failed.push({
            imageKey: task.imageKey,
            usage: task.usage,
            fileName: task.file.name,
            reason: reason(error),
          });
        } finally {
          setState((prev) => ({ ...prev, done: prev.done + 1 }));
        }
      });

      // 서버가 한 요청에 50건까지 받는다. 청크마다 항목별 결과가 오므로 부분 성공이다.
      let lastPhase: BulkSessionPhase | null = null;
      for (const chunk of chunkResolutions(entries)) {
        try {
          const response = await resolveImages.mutateAsync(chunk);
          lastPhase = response.progress.phase;
          // 인덱스가 아니라 (imageKey, usage) 로 짝짓는다 — 중복이 축약돼 길이가 줄 수 있다.
          for (const result of pairResolveResults(chunk, response.results)) {
            if (result.ok) continue;
            const task = tasks.find(
              (t) => t.imageKey === result.imageKey && t.usage === result.usage
            );
            failed.push({
              imageKey: result.imageKey,
              usage: result.usage,
              fileName: task?.file.name ?? result.imageKey,
              reason: result.error ?? '서버가 이 파일을 받아들이지 않았습니다.',
            });
          }
        } catch (error) {
          // 청크 하나가 통째로 실패해도 나머지 청크는 계속 보낸다 — 부분 진행이 남는 편이
          // 전부 되돌리는 것보다 낫다(서버가 멱등이라 재시도가 안전하다).
          for (const entry of chunk) {
            const task = tasks.find(
              (t) => t.imageKey === entry.imageKey && t.usage === entry.usage
            );
            failed.push({
              imageKey: entry.imageKey,
              usage: entry.usage,
              fileName: task?.file.name ?? entry.imageKey,
              reason: reason(error),
            });
          }
        }
      }

      setState((prev) => ({ ...prev, running: false, failed }));
      return lastPhase;
    },
    [resolveImages]
  );

  const run = useCallback(
    async (
      files: File[],
      rows: BulkSessionImage[]
    ): Promise<BulkSessionPhase | null> => {
      const matched = matchFilesToImageRows(files, rows);
      setState((prev) => ({
        ...prev,
        unmatchedFiles: matched.unmatchedFiles,
        duplicateNames: matched.duplicateNames,
      }));
      if (matched.tasks.length === 0) return null;
      return runTasks(matched.tasks);
    },
    [runTasks]
  );

  const retryFailed =
    useCallback(async (): Promise<BulkSessionPhase | null> => {
      const keys = new Set(state.failed.map((f) => `${f.imageKey} ${f.usage}`));
      const retry = lastTasksRef.current.filter((t) =>
        keys.has(`${t.imageKey} ${t.usage}`)
      );
      if (retry.length === 0) return null;
      return runTasks(retry);
    }, [state.failed, runTasks]);

  return { state, run, retryFailed };
}
