import { Modules } from '@medusajs/framework/utils';
import { createWorkflow, transform, WorkflowResponse } from '@medusajs/framework/workflows-sdk';
import {
  acquireLockStep,
  createPriceListPricesWorkflow,
  createPriceListsWorkflow,
  createRemoteLinkStep,
  deletePriceListsWorkflow,
  dismissRemoteLinkStep,
  releaseLockStep,
  removePriceListPricesWorkflow,
  updatePriceListsWorkflow,
} from '@medusajs/medusa/core-flows';
import { TIME_SALE_MODULE } from '../../modules/time-sale';
import { buildPriceListData, planTimeSaleUpdate, type TimeSaleWriteInput } from './rules';
import {
  createTimeSaleRowStep,
  loadLinkedListsStep,
  prepareTimeSaleStep,
  softDeleteTimeSaleRowStep,
  updateTimeSaleRowStep,
} from './steps';

/**
 * 타임세일 쓰기 전체(생성·수정·삭제)를 직렬화하는 키 하나.
 *
 * - 같은 세일의 동시 수정: 둘 다 prepare 에서 같은 옛 가격 id 를 읽으면, 뒤의 것은 지울 게 없어(이미
 *   지워짐) 새 가격만 덧붙인다 — 741 품목이 1,482 행이 된다(통합 테스트로 재현).
 * - 서로 다른 세일의 동시 생성·공개: 겹침 검사가 서로를 못 본 채 둘 다 통과한다.
 * 세일 단위 키로는 두 번째를 못 막으므로 전역 키를 쓴다. 어드민 저장은 드물어 경합 비용이 작다.
 *
 * - ttl 120s: 741 품목 수정 한 번이 로컬에서 수 초~10여 초다. 프로세스가 죽어 해제를 못 해도 2분 뒤 풀린다.
 * - timeout 30s: 앞선 저장 하나(수 초)를 기다리기엔 넉넉하고, 그보다 길면 HTTP 요청이 먼저 끊긴다.
 * 실패 시 해제는 acquireLockStep 의 보상이 한다(core-flows: compensate → locking.release).
 * ownerId 는 주지 않는다 — redis provider 가 '*' 로 저장하고, '*' 가 쥔 키는 누구도 재진입하지 못한다.
 */
const TIME_SALE_WRITE_LOCK = { key: 'time-sale:write', timeout: 30, ttl: 120 };

const linkOf = (timeSaleId: string, priceListId: string) => ({
  [TIME_SALE_MODULE]: { time_sale_id: timeSaleId },
  [Modules.PRICING]: { price_list_id: priceListId },
});

/**
 * 세일 생성 = 세일 행 + price list 1~2개 + 링크. 한 워크플로라 어느 스텝이 실패해도 앞 스텝이 보상으로
 * 되감긴다 — 예전엔 브라우저가 리스트를 하나씩 만들어, 중간 실패가 절름발이 세일을 남겼다.
 */
export const createTimeSaleWorkflow = createWorkflow('create-time-sale', (input: TimeSaleWriteInput) => {
  acquireLockStep(TIME_SALE_WRITE_LOCK);
  const context = prepareTimeSaleStep({ input });
  const row = createTimeSaleRowStep(input);

  const priceListsData = transform({ input, context }, ({ input, context }) => {
    const shared = {
      title: input.title,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      status: input.status,
      regionIds: context.regionIds,
      membershipGroupId: context.membershipGroupId,
    };
    const lists = [buildPriceListData({ ...shared, audience: 'general', prices: input.general_prices })];
    if (input.membership_prices.length > 0) {
      lists.push(buildPriceListData({ ...shared, audience: 'membership', prices: input.membership_prices }));
    }
    return lists;
  });

  const created = createPriceListsWorkflow.runAsStep({ input: { price_lists_data: priceListsData } });

  const links = transform({ row, created }, ({ row, created }) =>
    created.map((list: { id: string }) => linkOf(row.id, list.id)),
  );
  createRemoteLinkStep(links);

  releaseLockStep({ key: TIME_SALE_WRITE_LOCK.key });
  return new WorkflowResponse(row);
});

/**
 * 세일 수정. 지울 가격 id 는 `prepareTimeSaleStep` 이 DB 에서 직접 읽는다(브라우저 응답을 믿지 않는다).
 * 가격은 «옛 것 지우기 → 새로 만들기» 순서로 한 워크플로에서 하고, 실패하면 둘 다 되감긴다
 * (지운 가격은 restorePrices, 만든 가격은 removePrices).
 */
export const updateTimeSaleWorkflow = createWorkflow(
  'update-time-sale',
  (input: TimeSaleWriteInput & { id: string }) => {
    // 잠금은 prepare(옛 가격 id 읽기) «앞» 이어야 한다 — 읽기와 지우기 사이에 다른 수정이 끼면 안 된다.
    acquireLockStep(TIME_SALE_WRITE_LOCK);
    const writeInput = transform({ input }, ({ input }) => {
      const { id: _id, ...rest } = input;
      return rest as TimeSaleWriteInput;
    });
    const context = prepareTimeSaleStep({ input: writeInput, id: input.id });
    const plan = transform({ writeInput, context }, ({ writeInput, context }) =>
      planTimeSaleUpdate({
        input: writeInput,
        lists: context.lists,
        regionIds: context.regionIds,
        membershipGroupId: context.membershipGroupId,
      }),
    );

    updateTimeSaleRowStep({ id: input.id, input: writeInput });
    updatePriceListsWorkflow.runAsStep({
      input: { price_lists_data: transform({ plan }, ({ plan }) => plan.listUpdates) },
    });
    removePriceListPricesWorkflow.runAsStep({
      input: { ids: transform({ plan }, ({ plan }) => plan.priceIdsToDelete) },
    });
    createPriceListPricesWorkflow.runAsStep({
      input: { data: transform({ plan }, ({ plan }) => plan.pricesToCreate) },
    });

    const created = createPriceListsWorkflow.runAsStep({
      input: { price_lists_data: transform({ plan }, ({ plan }) => plan.listsToCreate) },
    });
    createRemoteLinkStep(
      transform({ input, created }, ({ input, created }) =>
        created.map((list: { id: string }) => linkOf(input.id, list.id)),
      ),
    );

    dismissRemoteLinkStep(
      transform({ input, plan }, ({ input, plan }) => plan.listIdsToDelete.map((listId) => linkOf(input.id, listId))),
    );
    deletePriceListsWorkflow.runAsStep({
      input: { ids: transform({ plan }, ({ plan }) => plan.listIdsToDelete) },
    });

    releaseLockStep({ key: TIME_SALE_WRITE_LOCK.key });
    return new WorkflowResponse(transform({ input }, ({ input }) => ({ id: input.id })));
  },
);

export const deleteTimeSaleWorkflow = createWorkflow('delete-time-sale', (input: { id: string }) => {
  acquireLockStep(TIME_SALE_WRITE_LOCK);
  // 삭제는 검증 없이 연결된 리스트만 읽는다.
  const context = loadLinkedListsStep(input);
  dismissRemoteLinkStep(
    transform({ input, context }, ({ input, context }) => context.map((list) => linkOf(input.id, list.id))),
  );
  deletePriceListsWorkflow.runAsStep({
    input: { ids: transform({ context }, ({ context }) => context.map((list) => list.id)) },
  });
  softDeleteTimeSaleRowStep(input.id);
  releaseLockStep({ key: TIME_SALE_WRITE_LOCK.key });
  return new WorkflowResponse(transform({ input }, ({ input }) => ({ id: input.id })));
});
