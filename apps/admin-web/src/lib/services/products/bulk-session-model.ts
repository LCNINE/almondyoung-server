// src/lib/services/products/bulk-session-model.ts
// 일괄 세션 화면의 판정 로직 전량.
//
// admin-web 에는 렌더러가 없고(@testing-library 미설치) jest transform 이 `.ts` 만
// 다루므로, 컴포넌트 안에 남은 조건문은 테스트되지 않는 코드다. 판정은 전부 여기로 온다.

import type {
  BulkSessionImage,
  BulkSessionPhase,
  BulkSessionProgress,
  PurgeDraftsResult,
  ResolveImageEntry,
  ResolveImageResult,
  StatusCount,
} from '@/lib/types/dto/bulk-session';

export type BulkSessionView =
  | 'working'
  | 'review'
  | 'images'
  | 'drafted'
  | 'published'
  | 'canceled'
  | 'failed';

/**
 * 서버가 한 요청에 받는 해석 통보 상한.
 * apps/core/src/modules/catalog/operations/bulk-session/dto 의 `ResolveImagesDto` 에
 * 걸린 `@ArrayMaxSize(50)` 과 같은 값으로 유지해야 한다 — 어긋나면 400 이 난다.
 */
export const RESOLVE_CHUNK_SIZE = 50;

/** 폴링 간격. form-export.ts 의 선례와 같은 값이다. */
const POLL_MS = 2000;

/** 워커가 claim 하는 phase — 이 동안은 사람이 할 일이 없고 화면은 진행률만 보여준다. */
const WORKING_PHASES: readonly BulkSessionPhase[] = [
  'uploaded',
  'validating',
  'drafting',
  'publishing',
];

const VIEW_BY_PHASE: Record<BulkSessionPhase, BulkSessionView> = {
  uploaded: 'working',
  validating: 'working',
  review: 'review',
  awaiting_images: 'images',
  drafting: 'working',
  drafted: 'drafted',
  publishing: 'working',
  published: 'published',
  canceled: 'canceled',
  failed: 'failed',
};

export function getBulkSessionView(phase: BulkSessionPhase): BulkSessionView {
  return VIEW_BY_PHASE[phase];
}

/**
 * 알 수 없는 상태(undefined)는 **진행 중으로 본다.** 접수 직후 첫 응답 전이나 일시적
 * 5xx 에서 멈춤으로 읽으면 화면이 마운트 내내 굳는다(form-export.ts 가 같은 함정을 밟았다).
 */
export function isBulkSessionWorking(
  phase: BulkSessionPhase | undefined
): boolean {
  if (phase === undefined) return true;
  return WORKING_PHASES.includes(phase);
}

export function bulkSessionRefetchInterval(
  progress: BulkSessionProgress | undefined
): number | false {
  return isBulkSessionWorking(progress?.phase) ? POLL_MS : false;
}

export function bulkSessionListRefetchInterval(
  sessions: { phase: BulkSessionPhase }[] | undefined
): number | false {
  if (sessions === undefined) return POLL_MS;
  return sessions.some((s) => isBulkSessionWorking(s.phase)) ? POLL_MS : false;
}

export function toCountMap<S extends string>(
  counts: StatusCount<S>[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { status, count } of counts) out[status] = count;
  return out;
}

/**
 * draft 생성 진행률.
 *
 * **분모는 `itemTotal` 이다.** `totalRows` 는 "상품" 시트 데이터 행 수라 합성 아이템이
 * 빠져 아이템 수와 어긋난다(서버 DTO 가 명시 경고).
 */
export function computeDraftingProgress(p: BulkSessionProgress): {
  done: number;
  total: number;
} {
  const counts = toCountMap(p.itemCounts);
  const pending = counts.pending ?? 0;
  const total = p.itemTotal;
  return { done: Math.max(0, total - pending), total };
}

/**
 * 발행 진행률.
 *
 * `idle` 은 분모에서 뺀다 — 발행 대상으로 큐에 들어간 적 없는 행이라 분모에 넣으면
 * 진행률이 영원히 100% 에 도달하지 않는다.
 */
export function computePublishProgress(p: BulkSessionProgress): {
  done: number;
  total: number;
} {
  const counts = toCountMap(p.publishCounts);
  const pending = counts.pending ?? 0;
  const published = counts.published ?? 0;
  const failed = counts.failed ?? 0;
  return { done: published + failed, total: pending + published + failed };
}

/**
 * 파일명 정규화. 폴더 드롭은 `webkitRelativePath` 가 섞인 이름을 줄 수 있어 경로를 자른다.
 * 매칭 규약은 스펙 §3.9 — 대소문자 무시, 앞뒤 공백 제거.
 */
export function normalizeFileName(name: string): string {
  const basename = name.split(/[\\/]/).pop() ?? name;
  return basename.trim().toLowerCase();
}

export interface NamedFile {
  name: string;
}

export interface UploadTask<F extends NamedFile> {
  imageKey: string;
  usage: BulkSessionImage['usage'];
  contextId: string;
  file: F;
}

export interface MatchResult<F extends NamedFile> {
  tasks: UploadTask<F>[];
  /** 요구 목록에 없어 무시한 파일명. */
  unmatchedFiles: string[];
  /** 아직 파일이 오지 않은 요구. */
  missing: BulkSessionImage[];
  /** 정규화 후 이름이 겹치는 파일 — 뒤엣것이 이긴다. */
  duplicateNames: string[];
}

/**
 * 떨군 파일을 요구 행에 붙인다.
 *
 * **작업 단위는 파일이 아니라 행이다.** 같은 파일명을 `main` 과 `description` 이 각각
 * 요구하면 `contextId` 가 달라 같은 파일을 두 번 올린다(스펙 §3.9).
 */
export function matchFilesToImageRows<F extends NamedFile>(
  files: F[],
  rows: BulkSessionImage[]
): MatchResult<F> {
  const byName = new Map<string, F>();
  const duplicateNames: string[] = [];
  for (const file of files) {
    const key = normalizeFileName(file.name);
    if (byName.has(key) && !duplicateNames.includes(key))
      duplicateNames.push(key);
    byName.set(key, file); // 뒤엣것이 이긴다 — 워크북이 파일명만 받아 구분할 방법이 없다
  }

  const wanted = rows.filter(
    (row) => row.required && row.status === 'awaiting_upload'
  );
  const tasks: UploadTask<F>[] = [];
  const missing: BulkSessionImage[] = [];
  const used = new Set<string>();

  for (const row of wanted) {
    const key = normalizeFileName(row.sourceValue);
    const file = byName.get(key);
    if (!file) {
      missing.push(row);
      continue;
    }
    used.add(key);
    tasks.push({
      imageKey: row.imageKey,
      usage: row.usage,
      contextId: row.contextId,
      file,
    });
  }

  const unmatchedFiles = files
    .filter((f) => !used.has(normalizeFileName(f.name)))
    .map((f) => f.name);

  return { tasks, unmatchedFiles, missing, duplicateNames };
}

export function chunkResolutions(
  entries: ResolveImageEntry[],
  size: number = RESOLVE_CHUNK_SIZE
): ResolveImageEntry[][] {
  const out: ResolveImageEntry[][] = [];
  for (let i = 0; i < entries.length; i += size)
    out.push(entries.slice(i, i + size));
  return out;
}

export type PairedResolveResult = ResolveImageResult;

/**
 * 보낸 항목과 결과를 짝짓는다.
 *
 * **인덱스로 짝지으면 안 된다** — 서버 DTO 가 "같은 (imageKey, usage) 중복은 마지막 것만
 * 남아 길이가 줄 수 있다"고 명시 경고한다.
 */
export function pairResolveResults(
  sent: ResolveImageEntry[],
  results: ResolveImageResult[]
): PairedResolveResult[] {
  const key = (e: { imageKey: string; usage: string }): string =>
    `${e.imageKey} ${e.usage}`;
  const byKey = new Map(results.map((r) => [key(r), r]));
  return sent.map(
    (entry) =>
      byKey.get(key(entry)) ?? {
        imageKey: entry.imageKey,
        usage: entry.usage,
        ok: false,
        error: '서버가 이 항목의 결과를 돌려주지 않았습니다.',
      }
  );
}

/**
 * `purge-drafts` 를 한 번 더 부를지.
 *
 * `remaining === 0` 만으로는 종료가 보장되지 않는다 — 영구 실패 행이 남으면 remaining 이
 * 줄지 않아 영원히 돈다. `purged === 0`(진전 없음)도 종료 조건이다.
 */
export function shouldContinuePurge(result: PurgeDraftsResult): boolean {
  return result.remaining > 0 && result.purged > 0;
}

export function canApprove(
  phase: BulkSessionPhase,
  undecidedCount: number
): boolean {
  return phase === 'review' && undecidedCount === 0;
}
