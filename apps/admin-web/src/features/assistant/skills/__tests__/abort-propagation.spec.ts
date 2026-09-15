import { productCatalogSkill } from '../product-catalog/skill';
import type { SkillContext, SkillTool } from '../types';

/**
 * 사용자가 Esc 로 요청을 끊으면 도구 안의 후속 요청도 나가면 안 된다.
 *
 * 도구 하나가 여러 번 호출할 때가 위험하다. set_product_price 는 기존 규칙을
 * 조회한 뒤 저장하는데, 조회 도중 취소되면 그 뒤의 PUT 은 사용자가 멈추라고 한
 * 작업을 그대로 실행하는 것이다. 실행 직전 한 번만 확인해서는 막을 수 없다.
 */

function toolNamed(name: string): SkillTool {
  const tool = productCatalogSkill.tools.find(
    (candidate) => candidate.definition.name === name
  );
  if (!tool) throw new Error(`도구 없음: ${name}`);
  return tool;
}

const setPrice = toolNamed('set_product_price');

type Recorded = { method: string; url: string };

function fakeCtx(options: { abortDuringGet?: boolean } = {}) {
  const controller = new AbortController();
  const calls: Recorded[] = [];

  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url: String(url) });

    if (init?.signal?.aborted) {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }

    if (method === 'GET' && options.abortDuringGet) {
      // 조회 응답을 기다리는 사이에 사용자가 Esc 를 누른 상황.
      controller.abort();
    }

    return new Response(
      JSON.stringify({
        basePriceRules: [
          {
            id: 'r1',
            layer: 'base_price',
            order: 1,
            scopeType: 'all_variants',
            scopeTargetIds: null,
            operationType: 'override',
            operationValue: 20000,
            minQuantity: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        membershipPriceRules: [],
        tieredPriceRules: [],
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  const ctx: SkillContext = {
    coreHeaders: async () => ({}),
    coreApiUrl: 'http://core',
    fileServiceUrl: 'http://files',
    selfUrl: 'http://admin',
    signal: controller.signal,
    attachments: [],
  };

  return { ctx, calls, controller };
}

describe('취소 신호 전달', () => {
  it('조회 도중 취소되면 가격 저장 PUT 을 보내지 않는다', async () => {
    const { ctx, calls } = fakeCtx({ abortDuringGet: true });

    await expect(
      setPrice.execute({ versionId: 'v1', salePrice: 10000 }, ctx)
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });

  it('이미 취소된 상태면 조회조차 하지 않는다', async () => {
    const { ctx, calls, controller } = fakeCtx();
    controller.abort();

    await expect(
      setPrice.execute({ versionId: 'v1', salePrice: 10000 }, ctx)
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(calls).toHaveLength(0);
  });

  it('취소되지 않으면 평소대로 저장한다', async () => {
    const { ctx, calls } = fakeCtx();

    await setPrice.execute({ versionId: 'v1', salePrice: 10000 }, ctx);

    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  });
});
