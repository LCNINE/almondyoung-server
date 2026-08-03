import { isBulkItemPayload } from './bulk-session.types';

/** `productBulkImageUsageEnum` 과 같은 두 값. 참조 지점이 정한다(스펙 §3.9). */
export type BulkImageUsage = 'main' | 'description';

/**
 * 용도 → file-service 컨텍스트.
 *
 * 두 컨텍스트의 제약이 다르다 — `product-image` 는 `image/jpeg|png|webp` 10MB,
 * `product-description-image` 는 `image/*` 20MB
 * (apps/file-service/src/database/default-file-contexts.ts:162-181). 그래서 한 파일을
 * 대표와 본문 양쪽에 쓰면 두 번 올라가 fileId 가 둘이 된다(스펙 §3.9 — 막지 않는다).
 *
 * core 가 이 표를 드는 이유는 **통보된 fileId 가 그 용도로 올라간 파일인지 확인하기
 * 위해서**다. 확인하지 않으면 20MB gif 가 대표이미지 자리에 들어와 제약을 우회한다.
 */
export const BULK_IMAGE_CONTEXT_BY_USAGE: Record<BulkImageUsage, string> = {
  main: 'product-image',
  description: 'product-description-image',
};

/**
 * 이미지 참조 하나의 정체성. **키만으로 비교하면 안 된다** — 이미지 행의 유니크 제약이
 * `(sessionId, imageKey, usage)` 라(catalog.schema.ts:1441) 한 파일을 본문용으로만 쓰는
 * 행이 대표용 업로드까지 기다리게 된다(2단계 `hasPendingImageWork` 독스트링과 같은 근거).
 */
export function imageRefKey(usage: BulkImageUsage, imageKey: string): string {
  return `${usage}:${imageKey}`;
}

/** 컨트롤러·DTO 입력 가드. 배열 `.includes()` 는 리터럴 유니언과 `string` 이 만나 타입 오류가 나므로 비교 체인으로 판정한다(`isBulkItemStatus` 와 같은 관례). */
export function isBulkImageUsage(value: string): value is BulkImageUsage {
  return value === 'main' || value === 'description';
}

/**
 * 이 세션에서 **실제로 파일이 필요한** 참조 집합.
 *
 * 입력은 `status='pending'` 아이템의 `payload` 들이어야 한다 — 나중에 `invalid` 이 된 행이
 * 참조하던 파일까지 세면, 30행이 invalid 인 세션에서 작업자가 **절대 쓰이지 않을 파일
 * 30개**를 올려야 다음으로 넘어간다(2단계 `hasPendingImageWork` 독스트링).
 *
 * `payload` 는 jsonb 왕복 값이라 `unknown` 이다 — 가드를 통과한 것만 읽는다(롤링 배포에서
 * 옛 코드가 쓴 shape 을 만나도 죽지 않는다).
 *
 * **`isBulkItemPayload` 는 `imageRefs` 필드를 검증하지 않으므로** 이 함수가 `imageRefs` 자체의
 * 형태(배열인지, 원소가 올바른 구조인지)를 개별 검증한다. `imageRefs` 가 배열이 아니거나
 * 원소가 `{imageKey: string, usage: BulkImageUsage}` 를 만족하지 않으면 그 참조를 버린다 —
 * 이 함수는 세션 전체를 훑는 집계이므로, 개별 오염이 전체 실패를 일으키면 안 된다.
 */
export function collectReferencedImageRefs(payloads: unknown[]): Set<string> {
  const refs = new Set<string>();
  for (const payload of payloads) {
    if (!isBulkItemPayload(payload)) continue;
    if (!Array.isArray(payload.imageRefs)) continue;
    for (const ref of payload.imageRefs) {
      // 원소가 {imageKey: string, usage: BulkImageUsage} 형태인지 개별 검증
      if (typeof ref?.imageKey === 'string' && isBulkImageUsage(ref.usage)) {
        refs.add(imageRefKey(ref.usage, ref.imageKey));
      }
    }
  }
  return refs;
}

/** `checkFileMetadata` 가 보는 것만. file-service 응답 전체를 끌고 다니지 않는다. */
export interface FileMetadataForCheck {
  contextId: string;
  status: string;
}

/** 사람이 읽는 용도 이름. 오류 문구가 `main`/`description` 을 그대로 노출하면 작업자가 못 읽는다. */
const USAGE_LABEL: Record<BulkImageUsage, string> = {
  main: '대표·부가 이미지',
  description: '본문 이미지',
};

/**
 * 통보된 fileId 의 메타데이터가 그 용도에 맞는지 본다. 맞으면 `null`, 아니면 작업자에게
 * 그대로 보여줄 한국어 오류 문자열이다.
 */
export function checkFileMetadata(meta: FileMetadataForCheck, usage: BulkImageUsage): string | null {
  const expected = BULK_IMAGE_CONTEXT_BY_USAGE[usage];
  if (meta.contextId !== expected) {
    return `${USAGE_LABEL[usage]} 용도로 올린 파일이 아닙니다 (기대 컨텍스트 ${expected}, 실제 ${meta.contextId}).`;
  }
  if (meta.status === 'deleted') return '이미 삭제된 파일입니다.';
  return null;
}

/**
 * 한 요청 안의 중복을 정리한다 — 같은 `(imageKey, usage)` 가 두 번 오면 **마지막이 이긴다**.
 *
 * 정리하지 않으면 같은 행을 두 번 UPDATE 하면서 첫 번째 fileId 를 "교체된 옛 파일"로
 * 지우게 되는데, 그건 작업자가 방금 올린 파일이다.
 *
 * **순서는 유지하되 인덱스는 보장하지 않는다** — 중복을 접으므로 결과 배열이 요청보다
 * 짧아질 수 있다. 화면은 `(imageKey, usage)` 로 짝지어야 한다(`ResolveImagesResponseDto`
 * 의 `results` 계약).
 */
export function dedupeResolutions<T extends { imageKey: string; usage: BulkImageUsage }>(entries: T[]): T[] {
  const lastIndexByRef = new Map<string, number>();
  entries.forEach((entry, index) => lastIndexByRef.set(imageRefKey(entry.usage, entry.imageKey), index));
  return entries.filter((entry, index) => lastIndexByRef.get(imageRefKey(entry.usage, entry.imageKey)) === index);
}
