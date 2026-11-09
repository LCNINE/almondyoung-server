import { refreshCartItemsWorkflow } from '@medusajs/medusa/core-flows';
import { StepResponse } from '@medusajs/framework/workflows-sdk';
import { reconcileBundleLines, undoBundleReconcile, type BundleReconcileUndo } from '../../../utils/bundle-reconcile';

/**
 * 함께 구매 재판정. 담기·수량 수정·삭제·로그인 전환·카트 수정이 모두 이 refresh 를 지나고, 이 훅은 그 안에서
 * 가격 재계산·카트 다시 읽기·프로모션 갱신보다 «앞»에 돈다 — 여기서 바꾼 단가로 쿠폰이 계산된다.
 *
 * 훅의 문서상 용도는 가격 맥락을 돌려주는 것이고 여기서는 라인을 고친다. 그래서 맥락은 바꾸지 않고(undefined), 바꾼 라인은 보상으로 되돌릴 수 있게 남긴다.
 * 위치·입력이 바뀌면 `__tests__/reconcile-bundle-lines-hook.unit.spec.ts` 가 빨개진다.
 * 번들 라인이 없는 카트는 카트 모듈 조회 한 번으로 끝난다.
 */
refreshCartItemsWorkflow.hooks.setPricingContext(
  async ({ cart_id }, { container }) => {
    if (!cart_id) return new StepResponse(undefined, null);
    const { undo } = await reconcileBundleLines(container, cart_id);
    return new StepResponse(undefined, undo.restore.length + undo.created.length > 0 ? undo : null);
  },
  // refresh 의 뒤 단계가 실패해 조작이 되돌려지면 재판정이 바꾼 라인도 되돌린다
  async (undo: BundleReconcileUndo | null, { container }) => {
    if (undo) await undoBundleReconcile(container, undo);
  },
);
