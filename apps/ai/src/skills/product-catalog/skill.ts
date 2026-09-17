import { AI_SCOPE } from '../../platform/auth/ai-scopes';
import type { ComposeRequest } from '../../product-description/services/compose';
import type { Skill, SkillTool } from '../types';
import { RequestAbortedError, core, normalizeFileName, toolError, uploadToFileService } from '../types';

/** 상품 이미지는 이 컨텍스트로 올라간다 (file_contexts 시드와 같은 값). */
const PRODUCT_IMAGE_CONTEXT_ID = 'product-image';

/**
 * 상세설명 추출을 동시에 몇 청크까지 돌릴지. 청크 하나가 원본 20MB + base64 사본을
 * 물고 있어서 이 값이 곧 메모리 상한이다. 3이면 한 번에 24장까지 처리된다.
 */
const MAX_PARALLEL_EXTRACTS = 3;

/**
 * 모델이 주는 목록 개수의 상한. Core 는 limit 에 상한이 없어서 넘기는 대로 다 준다.
 * 결과는 도구 결과로 화면까지 한 프레임에 실려 가므로, 여기서 안 묶으면 그 프레임이
 * 클라이언트 파서 상한을 넘겨 성공한 턴이 실패로 보인다.
 */
const MAX_LIST_LIMIT = 100;

function listLimit(input: unknown): string {
  const raw = (input as { limit?: unknown })?.limit;
  const value = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 20;
  return String(Math.min(Math.max(value, 1), MAX_LIST_LIMIT));
}

function str(input: unknown, key: string): string | null {
  const v = (input as Record<string, unknown>)?.[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

const searchProducts: SkillTool = {
  definition: {
    name: 'search_products',
    description:
      '상품(마스터)을 검색한다. 사용자가 상품명으로 말할 때 masterId 를 찾는 수단이다. deleted=true 면 삭제된 상품을 본다.',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '상품명 검색어' },
        limit: { type: 'number', description: '기본 20, 최대 100' },
        deleted: {
          type: 'boolean',
          description: 'true 면 삭제된 상품 목록을 본다',
        },
      },
      required: [],
    },
  },
  async execute(input, ctx) {
    const limit = listLimit(input);
    if ((input as { deleted?: boolean })?.deleted) {
      return core(ctx, `/masters/deleted?page=1&limit=${limit}`);
    }
    const q = new URLSearchParams({ page: '1' });
    q.set('limit', limit);
    // Core 가 읽는 검색 키는 `q` 다 — `search` 로 보내면 조용히 무시되고 전체 목록이 온다.
    const keyword = str(input, 'keyword');
    if (keyword) q.set('q', keyword);
    return core(ctx, `/masters?${q}`);
  },
};

const listCategories: SkillTool = {
  definition: {
    name: 'list_categories',
    description:
      '카테고리 트리를 본다. 사용자가 "카테고리 보여줘" 라고 하거나, 상품에 카테고리를 넣어야 하는데 ID 를 모를 때 쓴다. 기본은 상위 2단계만 — 더 깊이 필요하면 maxDepth 를 올린다.',
    input_schema: {
      type: 'object',
      properties: {
        maxDepth: { type: 'number', description: '펼칠 깊이. 기본 2.' },
      },
      required: [],
    },
  },
  async execute(input, ctx) {
    const depth = (input as { maxDepth?: number })?.maxDepth ?? 2;
    return core(ctx, `/categories?maxDepth=${depth}`);
  },
};

const listMyDrafts: SkillTool = {
  definition: {
    name: 'list_my_drafts',
    description:
      '내가 만들다 만 상품(작성중 Draft) 목록을 최신순으로 본다. **일반 상품 검색(search_products)에는 발행 전 Draft 가 안 잡힌다** — "방금 만든 것", "만들다 만 상품", "임시저장" 같은 말에는 이 도구를 쓴다.',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '이름 검색어(선택)' },
        limit: { type: 'number', description: '기본 20, 최대 100' },
      },
      required: [],
    },
  },
  async execute(input, ctx) {
    const q = new URLSearchParams({ page: '1' });
    q.set('limit', listLimit(input));
    q.set('sort', 'createdAt');
    q.set('order', 'desc');
    const keyword = str(input, 'keyword');
    if (keyword) q.set('q', keyword);
    return core(ctx, `/versions/my-drafts?${q}`);
  },
};

const getProduct: SkillTool = {
  definition: {
    name: 'get_product',
    description: '상품 상세를 본다. 수정하기 전에 현재 값과 버전 상태(active/draft)를 확인하는 데 쓴다.',
    input_schema: {
      type: 'object',
      properties: { masterId: { type: 'string' } },
      required: ['masterId'],
    },
  },
  async execute(input, ctx) {
    const id = str(input, 'masterId');
    if (!id) return toolError('masterId 가 필요하다');
    return core(ctx, `/masters/${id}`);
  },
};

const createProduct: SkillTool = {
  definition: {
    name: 'create_product',
    description:
      '새 상품을 만든다. 빈 Master 와 Draft v1 이 생기고 내용은 아직 비어 있다 — 이어서 update_product_draft 로 채우고 publish_product_version 으로 발행해야 쇼핑몰에 보인다. 반환값의 masterId 와 id 를 다음 호출에 쓴다 — 응답의 id 가 새 Draft 의 versionId 다(versionId 라는 필드는 없다).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  async execute(_input, ctx) {
    return core(ctx, '/masters', { method: 'POST' });
  },
};

const createDraft: SkillTool = {
  definition: {
    name: 'create_product_draft',
    description:
      '기존 상품을 고치기 위해 현재 Active 버전을 복사한 새 Draft 를 만든다. **Active 버전은 직접 수정할 수 없으므로** 기존 상품 수정은 항상 여기서 시작한다. 반환값의 id 가 새 Draft 의 versionId 다 — 그 값을 update_product_draft 에 쓴다.',
    input_schema: {
      type: 'object',
      properties: { masterId: { type: 'string' } },
      required: ['masterId'],
    },
  },
  async execute(input, ctx) {
    const id = str(input, 'masterId');
    if (!id) return toolError('masterId 가 필요하다');
    return core(ctx, `/masters/${id}/versions`, { method: 'POST' });
  },
};

const updateDraft: SkillTool = {
  definition: {
    name: 'update_product_draft',
    description:
      'Draft 버전의 내용을 고친다. Draft 상태의 버전만 수정할 수 있다(Active/Inactive 는 403). 사용자가 말하지 않은 필드는 넣지 않는다 — 넣지 않은 필드는 그대로 유지된다. categoryIds 는 기존 카테고리를 통째로 대체하므로 일부만 주면 나머지가 사라진다.',
    input_schema: {
      type: 'object',
      properties: {
        masterId: { type: 'string' },
        versionId: { type: 'string' },
        name: { type: 'string', description: '상품명' },
        description: {
          type: 'string',
          description:
            '상세 본문(마크다운). 어드민 상세 화면이 쓰는 필드와 같다 — write_product_description 결과도 여기에 넣는다.',
        },
        descriptionHtml: {
          type: 'string',
          description: '옛 HTML 본문 필드. 마크다운 본문은 description 에 넣는다 — 여기 넣지 않는다.',
        },
        brand: { type: 'string' },
        supplyPrice: { type: 'number', description: '공급가' },
        marketPrice: { type: 'number', description: '시중가' },
        supplierId: { type: 'string', description: '공급처 ID' },
        categoryIds: {
          type: 'array',
          items: { type: 'string' },
          description: '기존 카테고리를 모두 대체한다',
        },
        primaryCategoryId: { type: 'string' },
        fulfillmentKind: {
          type: 'string',
          enum: ['physical', 'digital'],
          description: 'digital 은 배송 불필요·배송비 면제',
        },
        shippingGroupCode: {
          type: 'string',
          description: "배송비 그룹 코드. 비우면 'default'",
        },
        thumbnailFileId: {
          type: 'string',
          description: 'upload_product_image 가 돌려준 fileId',
        },
        additionalImageFileIds: {
          type: 'array',
          items: { type: 'string' },
          description: '추가 이미지 fileId 목록',
        },
        optionDiff: {
          type: 'object',
          description:
            '옵션(색상·사이즈 등)을 더하거나 고친다. 옵션을 추가하면 값 조합만큼 품목(variant)이 자동으로 만들어진다. 옵션을 안 주면 기본 품목 1개짜리 단일 상품이 된다.',
          properties: {
            add: {
              type: 'array',
              description: '새 옵션 그룹. 예: 색상(빨강·파랑), 사이즈(S·M·L)',
              items: {
                type: 'object',
                properties: {
                  displayName: { type: 'string', description: '옵션 이름. 예: 색상' },
                  sortOrder: { type: 'number' },
                  values: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        displayName: { type: 'string', description: '옵션 값. 예: 빨강' },
                        colorCode: { type: 'string', description: '색상 코드(#FF0000). 색상 옵션일 때만.' },
                        sortOrder: { type: 'number' },
                      },
                      required: ['displayName'],
                    },
                  },
                },
                required: ['displayName', 'values'],
              },
            },
          },
        },
        tags: { type: 'array', items: { type: 'string' } },
        seoTitle: { type: 'string' },
        seoDescription: { type: 'string' },
        seoKeywords: { type: 'array', items: { type: 'string' } },
        isWholesaleOnly: {
          type: 'boolean',
          description: '도매회원 전용. true 면 도매 회원에게만 판매된다.',
        },
        isVisibleToMembersOnly: {
          type: 'boolean',
          description: '멤버십 회원 전용 노출. true 면 비회원의 목록·검색·상세에서 숨겨진다.',
        },
        isOverseas: {
          type: 'boolean',
          description: '해외직구 상품. true 면 결제할 때 개인통관고유부호를 받는다.',
        },
      },
      required: ['masterId', 'versionId'],
    },
  },
  async execute(input, ctx) {
    const masterId = str(input, 'masterId');
    const versionId = str(input, 'versionId');
    if (!masterId || !versionId) {
      return toolError('masterId 와 versionId 가 모두 필요하다');
    }

    const body = { ...(input as Record<string, unknown>) };
    delete body.masterId;
    delete body.versionId;
    if (Object.keys(body).length === 0) {
      return toolError('고칠 필드가 하나도 없다');
    }

    return core(ctx, `/masters/${masterId}/versions/${versionId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },
};

type PricingRule = {
  order: number;
  layer: string;
  scopeType: string;
  operationType: string;
  operationValue: number;
  /** 응답은 없을 때 null 을 준다 — 저장할 땐 생략해야 한다. */
  scopeTargetIds?: string[] | null;
  minQuantity?: number | null;
};

/**
 * GET 응답을 PUT 요청 형태로 옮긴다.
 *
 * 그대로 되실으면 400 이다 — 응답에는 `scopeTargetIds: null` · `minQuantity: null` 과
 * `id`/`createdAt` 같은 서버 필드가 들어 있는데 저장 스키마는 그것을 받지 않는다.
 * null 인 선택 필드는 생략해야 한다.
 */
function toRuleInput(rule: PricingRule) {
  const out: Record<string, unknown> = {
    order: rule.order,
    layer: rule.layer,
    scopeType: rule.scopeType,
    operationType: rule.operationType,
    operationValue: rule.operationValue,
  };
  if (rule.scopeTargetIds != null) out.scopeTargetIds = rule.scopeTargetIds;
  if (rule.minQuantity != null) out.minQuantity = rule.minQuantity;
  return out;
}

/** 전 옵션 동일가 한 줄인가. 아니면 화면에서만 다룰 수 있는 복합 규칙이다. */
function isSimpleOverride(rules: PricingRule[]): boolean {
  if (rules.length === 0) return true;
  return rules.length === 1 && rules[0].scopeType === 'all_variants' && rules[0].operationType === 'override';
}

const writeDescription: SkillTool = {
  definition: {
    name: 'write_product_description',
    description:
      '상품 상세 페이지 본문을 만든다. 어드민 상품 상세 화면이 쓰는 것과 같은 AI 초안 생성기를 그대로 부르므로 형식과 품질이 화면에서 만든 것과 같다. 이미지에서 성분·사용법 같은 정보를 읽어 본문을 짜므로, 먼저 upload_product_image 로 이미지를 올려 fileId 를 얻어 넘긴다. 결과 마크다운을 update_product_draft 의 description 에 넣어야 상품에 반영된다. descriptionHtml 이 아니다.',
    input_schema: {
      type: 'object',
      properties: {
        fileIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'upload_product_image 가 돌려준 fileId 목록. 장수 제한은 없다 — 안에서 나눠 분석한 뒤 합친다. 상세컷이 많을수록 본문이 충실해진다.',
        },
        productName: { type: 'string', description: '상품명' },
        hint: {
          type: 'string',
          description: '어떤 톤·무엇을 강조할지 같은 추가 지시(선택)',
        },
        presetTitle: {
          type: 'string',
          description:
            '어드민이 저장해 둔 프롬프트 양식 이름(선택). 사용자가 양식을 지목하면 그 이름을 그대로 넘긴다. 비우면 기본 양식을 쓴다.',
        },
      },
      required: ['fileIds'],
    },
  },
  async execute(input, ctx) {
    const fileIds = (input as { fileIds?: unknown })?.fileIds;
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return toolError('fileIds 가 필요하다. upload_product_image 로 이미지를 먼저 올려 fileId 를 얻는다.');
    }

    // 정적 import 로 바꾸지 말 것 — 이 스킬 파일과 product-description 이 서로를
    // 참조해서(타입은 위에서 type-only 로 끊었다) 정적으로 엮으면 순환이 생긴다.
    const [
      { getAnthropicClient },
      { extractProductFacts },
      { composeProductDescription },
      { IMAGES_PER_CHUNK, chunkFileIds, mergeExtractResults },
    ] = await Promise.all([
      import('../../product-description/services/anthropic'),
      import('../../product-description/services/extract'),
      import('../../product-description/services/compose'),
      import('@packages/product-description'),
    ]);

    let client: Awaited<ReturnType<typeof getAnthropicClient>>;
    try {
      client = getAnthropicClient();
    } catch (err) {
      return toolError((err as Error).message ?? 'AI 설명 생성을 쓸 수 없다');
    }

    // 추출은 한 번에 8장까지다. 어드민 화면과 같이 나눠 보내고 합친다 —
    // 통째로 넘기면 9장부터 항상 400 이고, 모델은 스스로 고칠 방법이 없다.
    //
    // 청크는 병렬로 돈다. 순차로 돌리면 9장에서 러너의 40초 예산을 넘어
    // "시간이 오래 걸려 멈췄습니다" 로 턴이 끊긴다 (2026-09-17 실측).
    //
    // 단 한 번에 도는 청크 수는 묶는다. fileIds 는 모델이 주는 배열이라 개수
    // 상한이 없어서, 통째로 Promise.all 하면 메모리가 장수에 비례해 튄다.
    const ids = fileIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
    const chunks = chunkFileIds(ids, IMAGES_PER_CHUNK);

    const responses: Response[] = [];
    for (let i = 0; i < chunks.length; i += MAX_PARALLEL_EXTRACTS) {
      const wave = chunks.slice(i, i + MAX_PARALLEL_EXTRACTS);
      responses.push(...(await Promise.all(wave.map((chunk) => extractProductFacts(client, chunk, ctx.signal)))));
      if (ctx.signal?.aborted) throw new RequestAbortedError();
    }

    const extractedChunks: ComposeRequest['result'][] = [];
    for (const extracted of responses) {
      if (!extracted.ok) {
        const body = (await extracted.json().catch(() => ({}))) as { message?: string };
        return toolError(body.message ?? `상세 정보 추출 실패 (${extracted.status})`);
      }
      const { result } = (await extracted.json()) as { result: ComposeRequest['result'] };
      extractedChunks.push(result);
    }

    const result = mergeExtractResults(extractedChunks);

    const composed = await composeProductDescription(
      client,
      {
        result,
        productName: str(input, 'productName') ?? undefined,
        hint: str(input, 'hint') ?? undefined,
        presetTitle: str(input, 'presetTitle') ?? undefined,
      },
      { authHeaders: await ctx.coreHeaders(), signal: ctx.signal },
    );
    if (ctx.signal?.aborted) throw new RequestAbortedError();
    if (!composed.ok) {
      const body = (await composed.json().catch(() => ({}))) as { message?: string };
      return toolError(body.message ?? `상세 본문 생성 실패 (${composed.status})`);
    }

    const { markdown, truncated } = (await composed.json()) as {
      markdown: string;
      truncated?: boolean;
    };
    return { ok: true, markdown, truncated: truncated ?? false };
  },
};

const listVariants: SkillTool = {
  definition: {
    name: 'list_product_variants',
    description:
      '상품의 품목(variant) 목록을 본다. 옵션이 없으면 기본 품목 1개만 있다. 품목명을 고치거나 품절 처리하기 전에 어떤 품목이 있는지 확인하는 데 쓴다.',
    input_schema: {
      type: 'object',
      properties: {
        masterId: { type: 'string' },
        versionId: {
          type: 'string',
          description: '특정 버전의 품목을 볼 때. 생략하면 마스터 기준.',
        },
      },
      required: ['masterId'],
    },
  },
  async execute(input, ctx) {
    const masterId = str(input, 'masterId');
    if (!masterId) return toolError('masterId 가 필요하다');
    const versionId = str(input, 'versionId');
    return core(
      ctx,
      versionId ? `/variants/masters/${masterId}/versions/${versionId}` : `/variants/masters/${masterId}`,
    );
  },
};

const updateVariant: SkillTool = {
  definition: {
    name: 'update_product_variant',
    description:
      'Draft 버전에서 품목 하나를 고친다. 품목명·표시순서·상태(판매중/중단)·품목 코드(바코드)를 바꿀 수 있다. Draft 버전에서만 되고, 편집하면 품목 ID 가 바뀔 수 있으니 이어서 작업할 때는 응답의 ID 를 쓴다.',
    input_schema: {
      type: 'object',
      properties: {
        masterId: { type: 'string' },
        versionId: { type: 'string', description: 'Draft 버전 ID' },
        variantId: { type: 'string' },
        variantName: { type: 'string', description: '품목 이름' },
        status: {
          type: 'string',
          enum: ['active', 'inactive'],
          description: 'inactive 면 그 품목만 판매 중단된다.',
        },
        displayOrder: { type: 'number' },
        variantCode: {
          type: 'string',
          description: '품목 코드(바코드). 채널 어댑터가 이 값으로 외부 채널 상품과 매칭한다.',
        },
      },
      required: ['masterId', 'versionId', 'variantId'],
    },
  },
  async execute(input, ctx) {
    const masterId = str(input, 'masterId');
    const versionId = str(input, 'versionId');
    const variantId = str(input, 'variantId');
    if (!masterId || !versionId || !variantId) {
      return toolError('masterId, versionId, variantId 가 모두 필요하다');
    }

    const body = { ...(input as Record<string, unknown>) };
    delete body.masterId;
    delete body.versionId;
    delete body.variantId;
    if (Object.keys(body).length === 0) return toolError('고칠 값이 없다');

    return core(ctx, `/masters/${masterId}/versions/${versionId}/variants/${variantId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },
};

const setPrice: SkillTool = {
  definition: {
    name: 'set_product_price',
    description:
      'Draft 버전의 판매가와 멤버십 가격을 정한다. **가격이 없으면 발행이 막힌다** — 새 상품은 발행 전에 반드시 한 번 불러야 한다. 전 옵션 동일가만 다룬다. 옵션별로 가격이 갈리는 복합 규칙이 이미 있으면 덮어쓰지 않고 거부하므로, 그때는 상품 상세 화면에서 하도록 안내한다. 지정하지 않은 항목(멤버십 가격·수량별 할인)은 기존 설정이 그대로 남는다.',
    input_schema: {
      type: 'object',
      properties: {
        versionId: { type: 'string' },
        salePrice: {
          type: 'number',
          description: '판매가(원, 정수). 생략하면 판매가는 그대로 둔다.',
        },
        memberPrice: {
          type: 'number',
          description: '멤버십 가격(원, 정수). 생략하면 기존 멤버십 가격을 유지한다.',
        },
        clearMemberPrice: {
          type: 'boolean',
          description: '멤버십 가격을 없앨 때만 true. 사용자가 명시적으로 요청했을 때만 쓴다.',
        },
      },
      required: ['versionId'],
    },
  },
  async execute(input, ctx) {
    const versionId = str(input, 'versionId');
    if (!versionId) return toolError('versionId 가 필요하다');

    const salePrice = (input as { salePrice?: number })?.salePrice;
    const memberPrice = (input as { memberPrice?: number })?.memberPrice;
    const clearMember = (input as { clearMemberPrice?: boolean })?.clearMemberPrice === true;

    for (const [label, v] of [
      ['salePrice', salePrice],
      ['memberPrice', memberPrice],
    ] as const) {
      if (v !== undefined && (!Number.isInteger(v) || v < 1)) {
        return toolError(
          `${label} 은 1 이상 정수여야 한다. 0원(무료)은 가격 규칙으로 설정할 수 없으므로 사용자에게 여기서는 처리할 수 없다고 안내한다.`,
        );
      }
    }
    if (salePrice === undefined && memberPrice === undefined && !clearMember) {
      return toolError('바꿀 가격이 하나도 없다');
    }

    // PUT 은 전체 교체다. 기존 규칙을 읽어 지정하지 않은 레이어를 그대로 실어야
    // 멤버십 가격·수량별 할인이 조용히 사라지지 않는다.
    const current = await core(ctx, `/versions/${versionId}/pricing/rules`);
    if ((current as { ok?: boolean })?.ok === false) return current;

    const cur = current as {
      basePriceRules?: PricingRule[];
      membershipPriceRules?: PricingRule[];
      tieredPriceRules?: PricingRule[];
    };
    const baseNow = cur.basePriceRules ?? [];
    const memberNow = cur.membershipPriceRules ?? [];
    const tieredNow = cur.tieredPriceRules ?? [];

    if (salePrice !== undefined && !isSimpleOverride(baseNow)) {
      return toolError(
        '이 상품의 판매가는 옵션별로 갈리는 복합 규칙이라 여기서 바꾸면 그 설정이 사라진다. 상품 상세 화면의 가격 설정에서 수정해야 한다.',
      );
    }
    if ((memberPrice !== undefined || clearMember) && !isSimpleOverride(memberNow)) {
      return toolError(
        '이 상품의 멤버십 가격은 옵션별로 갈리는 복합 규칙이라 여기서 바꾸면 그 설정이 사라진다. 상품 상세 화면의 가격 설정에서 수정해야 한다.',
      );
    }

    const override = (layer: string, value: number): PricingRule => ({
      order: 1,
      layer,
      scopeType: 'all_variants',
      operationType: 'override',
      operationValue: value,
    });

    const nextBase = salePrice !== undefined ? [override('base_price', salePrice)] : baseNow.map(toRuleInput);
    if (nextBase.length === 0) {
      return toolError('판매가가 아직 없다. salePrice 를 함께 넘겨야 저장된다.');
    }

    const nextMember = clearMember
      ? []
      : memberPrice !== undefined
        ? [override('membership_price', memberPrice)]
        : memberNow.map(toRuleInput);

    return core(ctx, `/versions/${versionId}/pricing/rules`, {
      method: 'PUT',
      body: JSON.stringify({
        basePriceRules: nextBase,
        membershipPriceRules: nextMember,
        // 수량별 할인은 이 도구가 다루지 않는다 — 항상 원래대로 되싣는다.
        tieredPriceRules: tieredNow.map(toRuleInput),
      }),
    });
  },
};

const publishVersion: SkillTool = {
  destructive: true,
  definition: {
    name: 'publish_product_version',
    description:
      'Draft 를 Active 로 바꾼다. **이 시점에 비로소 쇼핑몰에 반영된다.** 기존 Active 는 자동으로 Inactive 가 되고, Inactive 버전을 다시 publish 하면 그 버전으로 롤백된다. 사용자가 명시적으로 발행·적용을 요청했을 때만 부른다.',
    input_schema: {
      type: 'object',
      properties: { masterId: { type: 'string' }, versionId: { type: 'string' } },
      required: ['masterId', 'versionId'],
    },
  },
  async execute(input, ctx) {
    const masterId = str(input, 'masterId');
    const versionId = str(input, 'versionId');
    if (!masterId || !versionId) {
      return toolError('masterId 와 versionId 가 모두 필요하다');
    }
    return core(ctx, `/masters/${masterId}/versions/${versionId}/publish`, {
      method: 'PATCH',
    });
  },
};

const uploadImage: SkillTool = {
  definition: {
    name: 'upload_product_image',
    description:
      '이번 메시지에 첨부한 이미지를 올리고 fileId 를 받는다. 그 fileId 를 update_product_draft 의 thumbnailFileId 나 additionalImageFileIds 에 넣어야 상품에 실제로 붙는다 — 올리기만 하면 아무 상품에도 연결되지 않는다.',
    input_schema: {
      type: 'object',
      properties: {
        fileName: {
          type: 'string',
          description: '첨부가 여러 개일 때 올릴 파일명. 생략하면 첨부된 이미지를 전부 올린다.',
        },
      },
      required: [],
    },
  },
  async execute(input, ctx) {
    const images = ctx.attachments.filter((a) => a.mimeType.startsWith('image/'));
    if (images.length === 0) {
      return toolError('이번 메시지에 이미지 첨부가 없다. 사용자에게 이미지를 첨부해 달라고 요청한다.');
    }

    const only = str(input, 'fileName');
    const targets = only ? images.filter((a) => normalizeFileName(a.fileName) === normalizeFileName(only)) : images;
    if (targets.length === 0) {
      return toolError(`첨부 중에 ${only} 이(가) 없다`);
    }

    const uploaded: { fileName: string; fileId: string; url: string }[] = [];
    const consumedIds: string[] = [];
    const failed: { fileName: string; error: string }[] = [];

    for (const file of targets) {
      const r = await uploadToFileService(ctx, file, PRODUCT_IMAGE_CONTEXT_ID);
      if ((r as { ok?: boolean })?.ok === false) {
        failed.push({
          fileName: file.fileName,
          error: String((r as { error?: string }).error ?? '업로드 실패'),
        });
        continue;
      }
      const f = r as { id: string; url: string };
      uploaded.push({ fileName: file.fileName, fileId: f.id, url: f.url });
      consumedIds.push(file.id);
    }

    // 성공한 것만 패널이 첨부에서 지운다.
    return {
      ok: failed.length === 0,
      uploaded,
      failed,
      consumedIds,
    };
  },
};

const deleteProduct: SkillTool = {
  destructive: true,
  definition: {
    name: 'delete_product',
    description:
      '상품을 삭제한다(soft delete — 목록에서 사라지고 판매가 중단된다). restore_product 로 되살릴 수 있다. 사용자가 명시적으로 삭제를 요청했고, 어떤 상품인지 이름으로 확인받은 뒤에만 부른다.',
    input_schema: {
      type: 'object',
      properties: { masterId: { type: 'string' } },
      required: ['masterId'],
    },
  },
  async execute(input, ctx) {
    const id = str(input, 'masterId');
    if (!id) return toolError('masterId 가 필요하다');
    return core(ctx, `/masters/${id}`, { method: 'DELETE' });
  },
};

const restoreProduct: SkillTool = {
  destructive: true,
  definition: {
    name: 'restore_product',
    description: '삭제된 상품을 되살린다.',
    input_schema: {
      type: 'object',
      properties: { masterId: { type: 'string' } },
      required: ['masterId'],
    },
  },
  async execute(input, ctx) {
    const id = str(input, 'masterId');
    if (!id) return toolError('masterId 가 필요하다');
    return core(ctx, `/masters/${id}/restore`, { method: 'POST' });
  },
};

const unpublishProduct: SkillTool = {
  destructive: true,
  definition: {
    name: 'unpublish_product',
    description: '판매를 중단한다(Active 버전을 내린다). 상품을 지우지 않고 노출만 멈추고 싶을 때 삭제 대신 쓴다.',
    input_schema: {
      type: 'object',
      properties: { masterId: { type: 'string' } },
      required: ['masterId'],
    },
  },
  async execute(input, ctx) {
    const id = str(input, 'masterId');
    if (!id) return toolError('masterId 가 필요하다');
    return core(ctx, `/masters/${id}/unpublish`, { method: 'PATCH' });
  },
};

export const productCatalogSkill: Skill = {
  name: 'product-catalog',
  scopes: [AI_SCOPE.ASSISTANT],
  label: '상품 등록·수정·삭제',
  tools: [
    searchProducts,
    listCategories,
    listMyDrafts,
    getProduct,
    createProduct,
    createDraft,
    updateDraft,
    listVariants,
    updateVariant,
    writeDescription,
    setPrice,
    uploadImage,
    publishVersion,
    unpublishProduct,
    deleteProduct,
    restoreProduct,
  ],
  instructions: `상품 하나하나를 등록·수정·삭제한다. 엑셀로 여러 건을 한 번에 다루는 일은 「상품 일괄 등록/수정」 스킬이 맡는다 — 수십 건이면 그쪽을 안내한다.

### 버전 모델 — 이걸 모르면 전부 403 이 난다

상품은 **Master** 한 개와 그 아래 **Version** 여러 개로 되어 있다. 손님에게 보이는 것은 Active 버전 하나뿐이고, **Active 는 직접 수정할 수 없다.**

- **새 상품**: \`create_product\` → \`update_product_draft\` → \`set_product_price\` → \`publish_product_version\`
- **기존 상품 수정**: \`create_product_draft\` (Active 복사본) → \`update_product_draft\` → \`publish_product_version\`

발행하기 전까지는 손님에게 아무 변화도 없다. 수정만 하고 발행을 안 하면 Draft 로 남는다 — 사용자가 "적용해줘"라고 하지 않았다면 발행하지 말고, 발행이 남았다는 것을 알린다.

### 새 상품을 만들 때 — 정보를 먼저 모으고 그다음에 만든다

**\`create_product\` 는 최소 정보가 모인 뒤에 부른다.** 요청을 듣자마자 부르면 「새 상품」이라는
이름 없는 빈 Draft 가 남고, 사용자가 나중에 그걸 찾아 지워야 한다. 실제로 그렇게 쌓였다.

- "새 상품 만들어줘" 만 들었다 → **아직 만들지 않는다.** 필요한 것을 물어본다.
- 이름과 판매가를 받았다 → 그때 \`create_product\` → \`update_product_draft\` → \`set_product_price\` 를 이어서 한다.

최소로 필요한 것: **상품명**, **판매가**.

**판매가가 없으면 초안 저장도 하지 않는다.** 가격 없는 상품은 발행이 막혀서
나중에 다시 찾아 고쳐야 하는 반쪽짜리 초안만 남는다. 판매가를 받을 때까지 묻는다.

판매가를 받으면 **멤버십 가격도 함께 묻는다.** "회원가" 처럼 뜻이 갈리는 말을 쓰지 말고
**멤버십 가격**이라고 분명히 말한다 — 멤버십 회원에게만 보이는 별도 판매가다.
> "멤버십 회원에게 적용할 멤버십 가격도 정하시겠어요? 안 정하시면 일반 판매가만 적용됩니다."

사용자가 "판매가의 10% 싸게" 처럼 비율로 말하면 직접 계산해 넣고 계산 결과를 알린다.
> "멤버십 가격은 3,150원(10% 할인)으로 넣었습니다"
권장: 브랜드 · 카테고리 · 상세 내용 · **옵션**.

### 옵션과 품목을 반드시 확인한다

옵션을 안 넣으면 기본 품목 1개짜리 단일 상품이 된다. 색상·사이즈·용량처럼 고를 것이
있는 상품인데 그냥 만들면, 나중에 옵션을 붙이려고 상품을 다시 손봐야 한다.

**저장 전에 한 번 묻는다:**
> "색상·사이즈 같은 옵션이 있나요? 없으면 단일 상품으로 만듭니다."

상품명에 옵션 신호가 보이면(「3종 세트」 「S/M/L」 「블랙/투명」 같은 말) 먼저 짚는다.

옵션은 \`update_product_draft\` 의 \`optionDiff.add\` 로 넣는다. 값 조합만큼 품목이
자동으로 만들어진다 — 색상 2개 × 사이즈 3개면 품목 6개다.

\`\`\`
optionDiff: { add: [{ displayName: "색상", values: [{ displayName: "빨강" }, { displayName: "파랑" }] }] }
\`\`\`

품목 이름을 따로 손봐야 하면 \`list_product_variants\` 로 보고 \`update_product_variant\` 로 고친다.
품목 하나만 판매 중단하려면 그 품목의 status 를 inactive 로 둔다.

묻는 방식: 한 번에 하나씩 캐묻지 말고 필요한 것을 한 번에 나열한다.
> "이름과 판매가가 필요합니다. 브랜드·카테고리도 정하실 거면 같이 알려주세요."

### 사용자가 중간에 질문하면 멈춘다

"카테고리 리스트 보여줘" 처럼 **정보를 묻는 말**이 섞이면, 그 질문에 먼저 답하고 **진행을 멈춘다.**
묻는 중에 상품을 만들어 버리거나 다음 단계로 넘어가지 않는다. 사용자가 확인한 뒤에 이어간다.

### 카테고리 — 목록을 보고 골라줄 줄 알아야 한다

- 사용자가 카테고리 ID 를 알 리 없다. ID 를 달라고 요구하지 말고 \`list_categories\` 로 직접 본다.
- "적절한 걸로 설정해줘" 라고 하면 **목록을 보고 상품명에 맞는 것을 골라** \`update_product_draft\` 의
  \`categoryIds\` · \`primaryCategoryId\` 에 넣는다. 그리고 **무엇을 골랐는지 한 줄로 알린다.**
  > "「문구·스티커」로 넣었습니다. 다른 곳이 맞으면 알려주세요."
- 마땅한 것이 없거나 후보가 비슷하게 여럿이면 그때 두세 개를 제시하고 고르게 한다.

### 저장 전에 최종 내용을 보여주고 선택을 받는다

정보를 다 모았다고 바로 만들지 않는다. **무엇으로 저장될지 먼저 보여주고 선택을 받는다.**
그래야 사용자가 틀린 값을 미리 잡을 수 있고, 잘못된 Draft 가 남지 않는다.

정리해서 보여줄 것: 상품명 · 판매가 · 멤버십 가격 · 옵션(없으면 단일 상품) · 카테고리 · 브랜드 · 이미지 유무 · 상세 내용 유무 · 운영 설정 다섯 항목.
그리고 이렇게 묻는다:

> "이 내용으로 **초안 저장**할까요, **바로 발행**할까요?"

- "초안" → \`create_product\` → \`update_product_draft\` → \`set_product_price\` 까지만.
- "발행" → 위 세 단계 뒤에 \`publish_product_version\` 까지.
- 사용자가 값을 고치면 고친 내용으로 다시 보여주고 다시 묻는다.

**이 확인을 건너뛰고 만들지 않는다.** 단, 사용자가 "그냥 만들어" · "바로 발행해" 처럼
확인을 생략하라고 명시하면 그대로 진행한다.

### 첨부한 이미지는 다음 턴에도 남아 있다

사용자가 이미지를 첨부한 뒤 "카테고리 뭐뭐 있어?" 처럼 되물어도, 그 첨부는 유지된다.
**"이미지를 다시 첨부해 주세요" 라고 말하지 않는다.** 실제로 업로드할 때
\`upload_product_image\` 를 부르면 그 파일이 그대로 쓰인다.

### 이미지 — 첨부가 있으면 반드시 상품에 붙인다

사용자가 이미지를 첨부했는데 상품에 안 붙으면 그 작업은 실패한 것이다. 실제로 그런 일이 있었다.

1. \`upload_product_image\` 로 올려 fileId 를 받는다.
2. 그 fileId 를 \`update_product_draft\` 의 \`thumbnailFileId\`(대표) 나
   \`additionalImageFileIds\`(추가) 에 넣는다.
3. 붙였다는 사실을 답변에 적는다.

올리기만 하고 2번을 빼먹으면 어디에도 연결되지 않는다.

**이미 올린 이미지는 다시 달라고 하지 않는다.** 앞선 턴에서 \`upload_product_image\` 가
성공했다면 그 fileId 가 대화에 남아 있다. 대화를 거슬러 찾아 그대로 쓴다.
정말 없을 때만, 그것도 이렇게 묻는다:
> "처음에 주신 이미지를 대표 이미지로 쓸까요?"

"이미지를 첨부해 주시면 …" 같은 말로 이미 준 것을 다시 요구하지 않는다.

이미지가 여러 장이면 첫 장을 대표로, 나머지를 추가 이미지로 넣고 그렇게 했다고 알린다.

### 상품에 대한 글쓰기는 업무다

상품 상세설명·상품명·SEO 문구를 쓰는 것은 이 쇼핑몰의 상품에 대한 글이므로 업무 밖이 아니다.
공통 규칙("머릿속 지식만으로 문단을 쓰면 업무 밖")을 이유로 거절하지 않는다 — 여기서 쓰는 글은
일반 지식이 아니라 그 상품의 이미지와 정보에서 나온다.

### 상세 내용은 전용 AI 에 맡긴다

"상세 내용 적당히 꾸며줘" 같은 요청에 직접 글을 쓰지 말고 \`write_product_description\` 을 부른다.
어드민 상품 상세 화면이 쓰는 것과 같은 생성기라 형식과 품질이 화면에서 만든 것과 같다.
이미지를 먼저 올려 fileId 를 넘겨야 성분·사용법까지 읽어 본문을 짠다.
돌려받은 마크다운은 \`update_product_draft\` 의 \`description\` 에 넣는다.
어드민 상세 화면이 저장하는 필드와 같아야 한다 — \`descriptionHtml\` 에 넣으면 서식이 깨지고
화면이 읽는 본문에도 안 보인다.

### 저장하기 전에 빈 칸을 짚는다

초안 저장이든 발행이든, 아래가 비어 있으면 그냥 넘어가지 않는다. 요약에 "없음" 이라고
적어만 두면 사용자는 그게 문제인지 모른다. **무엇이 비었고 비면 어떻게 되는지 말하고,
채울지 그냥 갈지 ask_choice 로 고르게 한다.**

| 빈 항목 | 그대로 두면 |
|---|---|
| 상세 내용(description) | 상품 페이지에 설명이 한 줄도 없다. 고객이 무엇인지 모르고 산다 |
| 대표 이미지(thumbnailFileId) | 목록·검색에서 빈 칸으로 보인다 |
| 공급가(supplyPrice) | 통계의 원가·마진·마진율이 이 상품만 계산 불가로 빈다 |
| 카테고리(categoryIds) | 카테고리 목록에 안 뜬다. 검색 색인의 카테고리명도 비어, 그 말이 들어간 검색어에 불리해진다 |

묻는 방식 — 빠진 것을 한 번에 모아 선택지로 낸다:
> ask_choice("상세 내용과 공급가가 비어 있습니다. 어떻게 할까요?", [
>   { label: "상세 내용 AI 로 만들기", value: "상세 내용을 AI로 만들어줘" },
>   { label: "공급가 입력하기", value: "공급가를 알려줄게" },
>   { label: "그대로 초안 저장", value: "비어 있는 채로 초안 저장해줘" },
> ])

**발행할 때는 더 세게 짚는다.** 초안은 나중에 채우면 되지만, 발행은 그 상태로 고객에게
바로 보인다. 상세 내용이나 대표 이미지가 없으면 발행 전에 반드시 확인받는다.

사용자가 "그냥 저장해" · "비어도 돼" 라고 하면 두 번 묻지 않고 넘어간다.

### 운영 옵션도 함께 확인한다

저장 전 확인에서 **기본값을 제시하고 바꿀지 묻는다.** 사용자가 모를 값을 캐묻지 말고,
기본값으로 두면 어떻게 되는지 한 줄로 알려준 뒤 고칠 것만 받는다.

**항목을 빠짐없이 나열한다.** "운영 정책은 어떻게 할까요?" 처럼 뭉뚱그리면
사용자는 무엇을 고를 수 있는지 모른다. 아래 다섯 가지를 기본값과 함께 보여준다.

| 항목 | 기본 | 바꾸면 |
|---|---|---|
| 배송 유형 | 실물 (배송비 부과) | 디지털이면 배송비 면제 |
| 배송비 그룹 | 기본배송 | 간편식 등 별도 그룹 지정 |
| 해외직구 | 아니오 | 결제할 때 개인통관고유부호를 받는다 |
| 도매 전용 | 아니오 | 도매 회원에게만 판매된다 |
| 멤버십 전용 노출 | 아니오 | 비회원의 목록·검색·상세에서 숨겨진다 |

제시 방식 — 표 대신 한 덩이로 적되 항목을 다 적는다:
> "운영 설정은 이렇게 잡았습니다.
> · 배송 유형: 실물(배송비 부과) · 배송비 그룹: 기본배송
> · 해외직구: 아니오 · 도매 전용: 아니오 · 멤버십 전용 노출: 아니오
> 바꿀 항목이 있으면 알려주세요."

**해외직구는 특히 짚는다** — 잘못 두면 통관 정보를 못 받아 배송이 막힌다.
상품명이나 브랜드에 해외 제품 신호가 있으면 먼저 물어본다.
디지털 상품(파일 다운로드)이 분명해 보이면 그것도 먼저 확인한다 — 배송비가 잘못 붙으면 주문이 꼬인다.

### 반드시 지킬 것

1. **사용자가 말하지 않은 필드는 보내지 않는다.** 안 보낸 필드는 그대로 유지된다. "가격만 바꿔줘"에 이름이나 설명을 같이 보내지 않는다.
2. **\`categoryIds\` 는 기존 카테고리를 통째로 대체한다.** 하나를 추가하려면 \`get_product\` 로 현재 목록을 읽어 거기에 더해서 보낸다. 새 것만 보내면 나머지가 사라진다.
3. **삭제·판매중단·발행은 명시적으로 요청받았을 때만 부른다.** 삭제 전에는 어떤 상품인지 이름으로 확인받는다.
4. 상품을 이름으로 말하면 \`search_products\` 로 masterId 를 먼저 찾는다. 결과가 여럿이면 사용자에게 어느 것인지 묻는다 — 임의로 고르지 않는다.
   - **0건이 나와도 없습니다 로 끝내지 않는다.** 검색은 부분 일치라 오타·띄어쓰기 하나에도 빗나간다. 키워드를 줄여 **한 번 더 찾아보고 후보를 제시한다.**
     - "반하다 레쉬 클렌저 110ml" 0건 → \`반하다\` 나 \`클렌저\` 처럼 **가장 특징적인 한 단어**로 재검색
     - 그래도 0건이면 그때 없다고 말한다.
   - 후보를 찾으면 **"혹시 이 상품인가요?"** 로 제시한다. 사용자가 철자를 고쳐 다시 말하게 만들지 않는다.
   - **발행 전 Draft 는 \`search_products\` 에 안 잡힌다.** "방금 만든 것" · "만들다 만 상품" · "임시저장" 을 찾을 때는 \`list_my_drafts\` 를 쓴다.
5. 값을 지우려면 \`null\` 을 명시한다. 확신이 없으면 비우지 말고 묻는다.

### 삭제와 판매중단은 다르다

- \`delete_product\` — 목록에서 사라진다. \`restore_product\` 로 되살릴 수 있다.
- \`unpublish_product\` — 상품은 남고 노출만 멈춘다. 다시 팔 계획이면 이쪽이 맞다.

어느 쪽인지 애매하면 사용자에게 묻는다.

### 권한

admin 또는 master 권한이 필요하다. 403 이 나면 상품 문제가 아니라 계정 권한 문제다.`,
};
