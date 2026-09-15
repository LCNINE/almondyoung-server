import { productUploadSkill } from '../product-upload/skill';
import { productCatalogSkill } from '../product-catalog/skill';
import type { SkillAttachment, SkillContext, SkillTool } from '../types';

/**
 * 업로드 도구가 실제로 쓴 첨부만 소비로 보고하는지 지킨다.
 *
 * 패널은 여기서 돌려준 `consumedIds` 만 첨부 목록에서 지운다. 이 계약이 깨지면
 * 재시도해야 할 파일이 조용히 사라지고, 사용자는 같은 이미지를 다시 첨부해야 한다.
 * 파일명이 아니라 id 로 식별하는 이유도 같다 — 같은 이름의 첨부가 둘일 수 있다.
 */

const att = (id: string, fileName: string): SkillAttachment => ({
  id,
  fileName,
  mimeType: 'image/png',
  bytes: Buffer.from(id),
});

type FakeOptions = {
  /** 이 id 들의 업로드는 file-service 가 거부한다. */
  failIds?: string[];
  /**
   * n 번째 업로드 호출만 거부한다(1부터). 같은 파일이 여러 요구에 걸릴 때
   * 앞은 성공하고 뒤만 실패하는 상황을 만들려면 id 로는 표현할 수 없다.
   */
  failOnCall?: number[];
  /** 세션이 요구하는 파일명 목록. 같은 파일명을 두 번 넣으면 요구가 둘이다. */
  required?: string[];
};

function fakeCtx(attachments: SkillAttachment[], options: FakeOptions = {}): SkillContext {
  const failIds = new Set(options.failIds ?? []);
  const failOnCall = new Set(options.failOnCall ?? []);
  let uploadCalls = 0;

  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    const target = String(url);

    if (target.includes('/files/upload')) {
      const file = (init?.body as FormData).get('file') as File;
      const id = Buffer.from(await file.arrayBuffer()).toString();
      uploadCalls += 1;
      return failIds.has(id) || failOnCall.has(uploadCalls)
        ? new Response(JSON.stringify({ message: '업로드 거부' }), { status: 400 })
        : new Response(
            JSON.stringify({ id: `fid-${id}`, url: 'u', fileName: file.name }),
            { status: 200 }
          );
    }

    if (target.includes('/images?')) {
      const rows = (options.required ?? []).map((name, index) => ({
        imageKey: `K${index}`,
        usage: index % 2 === 0 ? 'main' : 'description',
        contextId: 'ctx',
        sourceValue: name,
      }));
      return new Response(JSON.stringify({ data: rows, total: rows.length }), {
        status: 200,
      });
    }

    if (target.includes('/images/resolve')) {
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }

    throw new Error(`예상하지 못한 호출: ${target}`);
  }) as typeof fetch;

  return {
    coreHeaders: async () => ({}),
    coreApiUrl: 'http://core',
    fileServiceUrl: 'http://files',
    selfUrl: 'http://admin',
    attachments,
  };
}

function toolNamed(skill: { tools: SkillTool[] }, name: string): SkillTool {
  const tool = skill.tools.find((candidate) => candidate.definition.name === name);
  if (!tool) throw new Error(`도구 없음: ${name}`);
  return tool;
}

const sessionImages = toolNamed(productUploadSkill, 'upload_session_images');
const productImage = toolNamed(productCatalogSkill, 'upload_product_image');

const consumed = (result: unknown) => (result as { consumedIds: string[] }).consumedIds;

describe('upload_session_images 의 첨부 소비', () => {
  it('한 첨부가 대표·상세 양쪽에 쓰이고 뒤쪽만 실패하면 소비하지 않는다', async () => {
    // 같은 파일이 두 요구(main/description)에 걸린다. 첫 업로드는 성공하고
    // 두 번째만 실패해야 "한 번이라도 성공하면 소비" 버그가 드러난다.
    const ctx = fakeCtx([att('A1', 'hero.png')], {
      required: ['hero.png', 'hero.png'],
      failOnCall: [2],
    });

    const result = await sessionImages.execute({ sessionId: 's1' }, ctx);

    expect((result as { uploaded: number }).uploaded).toBe(1);
    expect((result as { failed: unknown[] }).failed).toHaveLength(1);
    // 재시도해야 하므로 첨부는 남아 있어야 한다.
    expect(consumed(result)).toEqual([]);
  });

  it('요구 목록에 없는 첨부는 소비하지 않는다', async () => {
    const ctx = fakeCtx([att('B1', 'need.png'), att('B2', 'extra.png')], {
      required: ['need.png'],
    });

    const result = await sessionImages.execute({ sessionId: 's1' }, ctx);
    expect(consumed(result)).toEqual(['B1']);
  });

  it('같은 이름의 첨부가 둘이면 실제로 쓴 하나만 소비한다', async () => {
    const ctx = fakeCtx([att('C1', 'same.png'), att('C2', 'same.png')], {
      required: ['same.png'],
    });

    expect(consumed(await sessionImages.execute({ sessionId: 's1' }, ctx))).toHaveLength(1);
  });

  it('매칭된 요구가 하나도 없으면 아무것도 소비하지 않는다', async () => {
    const ctx = fakeCtx([att('D1', 'x.png')], { required: ['y.png'] });

    const result = await sessionImages.execute({ sessionId: 's1' }, ctx);
    expect(consumed(result)).toEqual([]);
    expect((result as { stillMissing: string[] }).stillMissing).toEqual(['y.png']);
  });
});

describe('upload_product_image 의 첨부 소비', () => {
  it('같은 이름의 첨부 중 실패한 쪽은 남긴다', async () => {
    const ctx = fakeCtx([att('E1', 'cat.png'), att('E2', 'cat.png')], {
      failIds: ['E2'],
    });

    const result = await productImage.execute({}, ctx);
    expect(consumed(result)).toEqual(['E1']);
    expect((result as { failed: unknown[] }).failed).toHaveLength(1);
  });

  it('파일명을 지정하면 그 첨부만 소비한다', async () => {
    const ctx = fakeCtx([att('F1', 'a.png'), att('F2', 'b.png')]);

    const result = await productImage.execute({ fileName: 'b.png' }, ctx);
    expect(consumed(result)).toEqual(['F2']);
  });
});
