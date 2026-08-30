import {
  createPromotionsWorkflow,
  updatePromotionsWorkflow,
  deletePromotionsWorkflow,
} from '@medusajs/core-flows';
import { StepResponse } from '@medusajs/framework/workflows-sdk';
import { PROMOTION_META_MODULE } from '../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../modules/promotion-meta/service';
import {
  applyMetaOnCreate,
  applyMetaOnDelete,
  applyMetaOnUpdate,
  restoreMetaSnapshots,
  type MetaSnapshot,
  type PromotionMetaWriter,
} from './apply-promotion-meta';

/**
 * `promotion_meta` 를 프로모션 라이프사이클에 **묶는다** (#488 N7 · N8 쓰기분 · 7-8).
 *
 * 옛 배선은 커스텀 `/admin/promotions` 라우트가 워크플로를 돌린 **뒤** `upsert` 를 불렀다.
 * 즉 메타 쓰기가 보상(compensation) 밖이라, 두 쓰기 사이에서 실패하면
 * **«발급 정책 없는 활성 쿠폰»** 이 남았다 — 그리고 메타가 없을 때의 기본값이 전부 「전체공개」였다.
 * 실측으로 재현했다(2026-08-31): `additional_data.visibility` 에 어휘 밖 값 → HTTP 500 →
 * 프로모션은 active 로 살아남고 `promotion_meta` 0행.
 *
 * 훅 안으로 들어오면 던지는 순간 `createPromotionsStep` 의 보상이 프로모션을 지운다.
 *
 * ⚠️ 훅은 **워크플로당 핸들러 1개**만 허용된다. 중복 등록하면 부팅이 죽는다
 * (`workflows/hooks/__tests__/no-duplicate-validate-hooks.unit.spec.ts` 가 지킨다).
 * 새 검증이 필요하면 **새 훅을 등록하지 말고 아래 핸들러 안에 함수를 더할 것.**
 */

/** 훅 인자의 `container` 는 `any` 로 온다 — resolve 만 쓰므로 여기서 최소 타입으로 좁힌다. */
type ResolvableContainer = { resolve: <T>(key: string) => T };

function writerFrom(container: ResolvableContainer): PromotionMetaWriter {
  return container.resolve<PromotionMetaModuleService>(
    PROMOTION_META_MODULE,
  ) as unknown as PromotionMetaWriter;
}

createPromotionsWorkflow.hooks.promotionsCreated(
  async ({ promotions, additional_data }: any, { container }: any) => {
    const written = await applyMetaOnCreate(
      writerFrom(container),
      promotions as { id: string }[],
      additional_data as Record<string, unknown> | undefined,
    );
    return new StepResponse(written, written);
  },
  async (written: string[] | undefined, { container }: any) => {
    if (!written?.length) return;
    const writer = writerFrom(container);
    for (const id of written) {
      await writer.deleteByPromotionId(id);
    }
  },
);

updatePromotionsWorkflow.hooks.promotionsUpdated(
  async ({ promotions, additional_data }: any, { container }: any) => {
    const snapshots = await applyMetaOnUpdate(
      writerFrom(container),
      promotions as { id: string }[],
      additional_data as Record<string, unknown> | undefined,
    );
    return new StepResponse(snapshots, snapshots);
  },
  async (snapshots: MetaSnapshot[] | undefined, { container }: any) => {
    if (!snapshots?.length) return;
    await restoreMetaSnapshots(writerFrom(container), snapshots);
  },
);

deletePromotionsWorkflow.hooks.promotionsDeleted(
  async ({ ids }: any, { container }: any) => {
    const snapshots = await applyMetaOnDelete(writerFrom(container), ids as string[]);
    return new StepResponse(snapshots, snapshots);
  },
  async (snapshots: MetaSnapshot[] | undefined, { container }: any) => {
    if (!snapshots?.length) return;
    await restoreMetaSnapshots(writerFrom(container), snapshots);
  },
);
