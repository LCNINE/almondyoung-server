import { SKILLS, buildToolDefinitions, runTool } from '../registry';
import type { SkillContext } from '../types';

/**
 * 되돌리기 어려운 작업은 코드가 막는다.
 *
 * 지시문으로만 막으면 모델이 그 문장을 무시하는 순간 상품이 지워진다. 프롬프트는
 * 규율이지 방어선이 아니므로, 확인 없이 들어온 호출은 레지스트리에서 거부한다.
 */

const DESTRUCTIVE = [
  'delete_product',
  'restore_product',
  'unpublish_product',
  'publish_product_version',
  'approve_bulk_session',
  'publish_bulk_session',
  'cancel_bulk_session',
  'retry_bulk_draft',
];

function ctx(): SkillContext {
  // 게이트에 막히면 여기까지 오지 않는다. 호출되면 그 자체가 실패다.
  global.fetch = (async () => {
    throw new Error('확인 없이 실제 요청이 나갔다');
  }) as typeof fetch;

  return {
    coreHeaders: async () => ({}),
    coreApiUrl: 'http://core',
    fileServiceUrl: 'http://files',
    selfUrl: 'http://admin',
    attachments: [],
  };
}

describe('파괴적 도구의 확인 게이트', () => {
  it.each(DESTRUCTIVE)('%s 는 confirmed 없이 실행되지 않는다', async (name) => {
    const result = (await runTool(
      name,
      { masterId: 'm1', versionId: 'v1', sessionId: 's1' },
      ctx()
    )) as { ok: boolean; needsConfirmation?: boolean };

    expect(result.ok).toBe(false);
    expect(result.needsConfirmation).toBe(true);
  });

  it('confirmed: false 도 거부한다', async () => {
    const result = (await runTool(
      'delete_product',
      { masterId: 'm1', confirmed: false },
      ctx()
    )) as { ok: boolean; needsConfirmation?: boolean };

    expect(result.needsConfirmation).toBe(true);
  });

  it('confirmed 문자열 "true" 는 통과시키지 않는다', async () => {
    const result = (await runTool(
      'delete_product',
      { masterId: 'm1', confirmed: 'true' },
      ctx()
    )) as { ok: boolean; needsConfirmation?: boolean };

    expect(result.needsConfirmation).toBe(true);
  });

  it('조회 도구는 확인 없이 그대로 돈다', async () => {
    let called = false;
    const readCtx: SkillContext = {
      ...ctx(),
      coreHeaders: async () => {
        called = true;
        return {};
      },
    };
    global.fetch = (async () =>
      new Response(JSON.stringify({ data: [], total: 0 }), {
        status: 200,
      })) as typeof fetch;

    await runTool('search_products', { keyword: 'x' }, readCtx);
    expect(called).toBe(true);
  });

  it('파괴적 도구의 스키마에 confirmed 가 노출된다', () => {
    const defs = buildToolDefinitions();
    for (const name of DESTRUCTIVE) {
      const def = defs.find((d) => d.name === name);
      expect(def?.input_schema.properties).toHaveProperty('confirmed');
    }
  });

  it('DESTRUCTIVE 목록과 실제 표시가 어긋나지 않는다', () => {
    const marked = SKILLS.flatMap((skill) =>
      skill.tools.filter((tool) => tool.destructive).map((tool) => tool.definition.name)
    );
    expect(marked.sort()).toEqual([...DESTRUCTIVE].sort());
  });
});
