import { extractMetaFromAdditionalData } from '../../../api/admin/promotions/helpers';

/**
 * `promotion_meta` 쓰기의 **순수 로직**. 컨테이너도 워크플로도 모른다.
 *
 * 훅 등록(`promotion-meta.ts`)은 전역 부수효과라 유닛 테스트가 닿지 않는다. 그래서 판정을
 * 여기로 뽑고 등록부는 얇게 둔다 — 「검증되려면 `.ts` 여야 한다」(#488 P1 교훈).
 */

/** 훅이 필요로 하는 `PromotionMetaModuleService` 의 최소 표면. */
export interface PromotionMetaWriter {
  getByPromotionId(id: string): Promise<any | null>;
  upsert(data: Record<string, unknown> & { promotion_id: string }): Promise<unknown>;
  deleteByPromotionId(id: string): Promise<void>;
}

/** 보상(compensation)에 쓸 이전 상태. `before: null` 은 「원래 없었다」는 뜻이다. */
export type MetaSnapshot = {
  promotion_id: string;
  before: Record<string, unknown> | null;
};

type PromotionLike = { id: string };

/**
 * 생성된 프로모션들에 메타를 쓴다. 메타를 쓴 `promotion_id` 목록을 돌려준다(보상 입력).
 *
 * `additional_data` 는 워크플로 단위 값이라 프로모션이 여럿이면 전부에 같은 메타가 간다.
 * 어드민 라우트는 항상 1건만 만들므로 실제로는 1:1 이다.
 */
export async function applyMetaOnCreate(
  writer: PromotionMetaWriter,
  promotions: PromotionLike[],
  additional_data: Record<string, unknown> | undefined | null,
): Promise<string[]> {
  const meta = extractMetaFromAdditionalData(additional_data);
  if (!meta) return [];

  const written: string[] = [];
  for (const promotion of promotions ?? []) {
    await writer.upsert({ promotion_id: promotion.id, ...meta });
    written.push(promotion.id);
  }
  return written;
}

/**
 * 수정된 프로모션들의 메타를 부분 갱신한다.
 *
 * ⚠️ `additional_data` 에 메타 키가 없으면 **조회조차 하지 않는다.** 어드민의 상태 토글
 * (`{ status }` 만 보낸다)이 메타를 건드리면 안 되기 때문이다.
 */
export async function applyMetaOnUpdate(
  writer: PromotionMetaWriter,
  promotions: PromotionLike[],
  additional_data: Record<string, unknown> | undefined | null,
): Promise<MetaSnapshot[]> {
  const meta = extractMetaFromAdditionalData(additional_data);
  if (!meta) return [];

  const snapshots: MetaSnapshot[] = [];
  for (const promotion of promotions ?? []) {
    const before = await writer.getByPromotionId(promotion.id);
    snapshots.push({ promotion_id: promotion.id, before: before ? { ...before } : null });
    await writer.upsert({ promotion_id: promotion.id, ...meta });
  }
  return snapshots;
}

/**
 * 삭제된 프로모션들의 메타를 정리한다.
 *
 * 옛 모델은 여기서 발급 로그(`promotion_issue_log`, 순수 dedup 부기)도 같이 지웠다
 * (`removeAllIssueLogs`, Task 10 이 걷어냄). `coupon_grant` 모델엔 그 부기 테이블의
 * 대응물이 없다 — dedup 키(`issue_key`)가 grant 행 자체의 유니크 인덱스에 있어서다.
 * 옛 코드도 실제 발급 자산(고객↔프로모션 링크)은 이 경로에서 건드리지 않았으니,
 * grant 도 여기서 건드리지 않는 것이 그 행동과 동형이다 — 삭제된 프로모션을 가리키는
 * grant 는 고아로 남지만, 옛 링크도 똑같이 고아로 남았었다.
 */
export async function applyMetaOnDelete(
  writer: PromotionMetaWriter,
  ids: string[],
): Promise<MetaSnapshot[]> {
  const snapshots: MetaSnapshot[] = [];
  for (const id of ids ?? []) {
    const before = await writer.getByPromotionId(id);
    snapshots.push({ promotion_id: id, before: before ? { ...before } : null });
    await writer.deleteByPromotionId(id);
  }
  return snapshots;
}

/**
 * 스냅샷대로 되돌린다. 보상 함수의 본체다.
 */
export async function restoreMetaSnapshots(
  writer: PromotionMetaWriter,
  snapshots: MetaSnapshot[],
): Promise<void> {
  for (const snapshot of snapshots ?? []) {
    if (snapshot.before) {
      await writer.upsert(snapshot.before as Record<string, unknown> & { promotion_id: string });
    } else {
      await writer.deleteByPromotionId(snapshot.promotion_id);
    }
  }
}
