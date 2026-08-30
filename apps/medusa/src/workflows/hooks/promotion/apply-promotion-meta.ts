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
  removeAllIssueLogs(id: string): Promise<void>;
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
 * 삭제된 프로모션들의 메타와 발급 로그를 정리한다.
 *
 * 발급 로그 정리는 **best-effort** 다 — 실패해도 삭제 전체를 되돌리지 않는다(옛 라우트의
 * `.catch(() => {})` 와 같은 판단이다. 로그는 이미 고아이고, 그것 때문에 프로모션 삭제를
 * 롤백하면 관리자가 지울 수 없는 쿠폰이 생긴다).
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
    await writer.removeAllIssueLogs(id).catch(() => {});
  }
  return snapshots;
}

/**
 * 스냅샷대로 되돌린다. 보상 함수의 본체다.
 *
 * ⚠️ 발급 로그는 되돌리지 않는다 — 삭제된 로그를 복원할 재료가 없다. 이 경로는 프로모션
 * 삭제가 롤백되는 경우에만 도는데, 그때 로그가 비어 있는 것은 자동발급 dedup 을 다시 여는
 * 쪽(재발급 가능)이라 고객이 쿠폰을 잃지 않는 방향이다.
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
