import { ProductImageUsage, ProductRecord, SessionImageMap } from '../dto/import.types';

/** reader 가 읽어오는 열만. 전체 행도 구조적으로 대입 가능하다. */
export interface SessionImageRow {
  imageKey: string;
  usage: ProductImageUsage;
  status: string;
  fileId: string | null;
  errorMessage: string | null;
}

export interface SessionImageIndex {
  fileIds: SessionImageMap;
  /** `${usage}:${imageKey}` → 실패 사유. **업로드에 성공하지 않은 행만** 담긴다. */
  failures: Map<string, string>;
}

function failureKey(usage: ProductImageUsage, imageKey: string): string {
  return `${usage}:${imageKey}`;
}

/**
 * 세션의 이미지 행을 커밋 슬라이스가 쓰는 두 구조로 접는다 — 성공한 것의 fileId 맵과
 * 실패한 것의 사유 맵. 슬라이스당 한 번만 만들고 그 안의 모든 행이 공유한다.
 */
export function indexSessionImages(rows: SessionImageRow[]): SessionImageIndex {
  const fileIds: SessionImageMap = { main: new Map(), description: new Map() };
  const failures = new Map<string, string>();

  for (const row of rows) {
    if (row.status === 'uploaded' && row.fileId) {
      fileIds[row.usage].set(row.imageKey, row.fileId);
      continue;
    }
    // uploaded 인데 fileId 가 없는 것은 있을 수 없는 상태지만, 조용히 통과시키면
    // 상품이 이미지 없이 생성된다 — 이 단계가 없애려는 바로 그 실패 모드다.
    const reason =
      row.status === 'uploaded'
        ? '업로드 상태이나 fileId 가 없습니다.'
        : (row.errorMessage ?? `이미지가 아직 처리되지 않았습니다 (status=${row.status})`);
    failures.set(failureKey(row.usage, row.imageKey), reason);
  }

  return { fileIds, failures };
}

/**
 * 이 행이 참조하는 이미지 중 하나라도 못 쓰면 사유 문자열을, 전부 쓸 수 있으면 null 을 돌려준다.
 *
 * **참조한 이미지가 하나라도 안 올라오면 그 상품 행은 실패한다**(계획 서두의 판단 1).
 * 대안("이미지 없이 만든다")은 이 단계가 존재하는 이유를 그대로 재생산하고, 게다가 조용하다 —
 * 관리자는 상품을 하나씩 열어보기 전엔 어디가 빠졌는지 모른다.
 */
export function unresolvedImageError(record: ProductRecord, index: SessionImageIndex): string | null {
  const problems: string[] = [];
  const check = (imageKey: string, usage: ProductImageUsage): void => {
    if (index.fileIds[usage].has(imageKey)) return;
    const reason = index.failures.get(failureKey(usage, imageKey)) ?? '이미지 정보를 찾을 수 없습니다.';
    problems.push(`${imageKey}(${usage === 'main' ? '대표/부가' : '본문'}): ${reason}`);
  };

  if (record.thumbnailImageKey) check(record.thumbnailImageKey, 'main');
  for (const key of record.additionalImageKeys ?? []) check(key, 'main');
  for (const key of record.descriptionImageKeys ?? []) check(key, 'description');

  if (problems.length === 0) return null;
  return `이미지를 준비하지 못해 상품을 만들 수 없습니다 — ${problems.join('; ')}`;
}
