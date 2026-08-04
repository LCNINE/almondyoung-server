// applier 가 정적으로 끌어오는 `product-masters.service.ts` 가 bare `@packages/event-contracts`
// 를 import 하는데, 루트 jest 설정의 moduleNameMapper 에는 `^@packages/event-contracts/(.*)$`
// (하위 경로)만 있고 bare 경로 항목이 없어 해석되지 않는다 — 레포 상시 debt 다. 레포에 이미
// 있는 선례(product-versions.service.spec.ts:1-7, bulk-session-merge.integration.spec.ts:1-15)
// 와 같은 모양으로 가상 모듈을 세운다.
jest.mock(
  '@packages/event-contracts',
  () => ({
    PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' },
  }),
  { virtual: true },
);

import { BulkDraftApplier, type DraftInput } from './bulk-draft.applier';
import type { FlatFields } from './bulk-session.types';

const VERSION_ID = '0198f000-0000-7000-8000-000000000001';
const MASTER_ID = '0198f000-0000-7000-8000-000000000002';
const SESSION_ID = '0198f000-0000-7000-8000-000000000003';
const USER_ID = '0198f000-0000-7000-8000-000000000004';
const ACTIVE_ID = '0198f000-0000-7000-8000-00000000000a';

interface Calls {
  updateVersion: unknown[][];
  replaceVersionRules: unknown[][];
  upsertForDraft: unknown[][];
  bulkUpdateVariantsInDraft: unknown[][];
  locked: Array<{ versionId: string; sessionId: string | null }>;
}

/**
 * (Task 7) 케이스별 서비스 페이크 오버라이드. `applier['versions'].getActiveVersion = ...`
 * 처럼 생성 뒤 private 필드에 직접 대입하는 방식은 쓰지 않는다 — 필드 타입이 실제 서비스
 * 클래스(`ProductVersionsService` 등)라, 테스트가 주는 좁은 반환값(`{id, masterId}`)이 실제
 * DTO 의 다른 필수 필드를 빠뜨려 타입 오류를 낸다. 대신 생성자 주입 시점에 페이크를
 * 완성해 넘긴다(그 값 전체는 기존과 같이 `as never` 로 소거) — 프로덕션 코드의
 * `private readonly` 접근 제어자는 테스트 편의로 낮추지 않는다.
 */
interface Overrides {
  masters?: Record<string, unknown>;
  versions?: Record<string, unknown>;
  variants?: Record<string, unknown>;
  optionLoader?: Record<string, unknown>;
  pricing?: Record<string, unknown>;
  constraints?: Record<string, unknown>;
}

function makeApplier(overrides: Overrides = {}) {
  const calls: Calls = {
    updateVersion: [],
    replaceVersionRules: [],
    upsertForDraft: [],
    bulkUpdateVariantsInDraft: [],
    locked: [],
  };

  // 잠금 UPDATE 는 applier 가 직접 쓰는 유일한 무조건 DB 문장이다. drizzle 빌더를 흉내 내는
  // 대신 set() 인자만 붙잡는다 — bulk-session.manager.spec.ts 가 세운 선례와 같은 깊이다.
  // select 는 resolveExistingCombos/resolveCreatedCombos 의 productMasterVariants 조회를
  // 흉내 낸다 — 기본값은 옵션 없는 상품의 유일한 variant 하나('v-old')다. 다른 매핑이
  // 필요한 케이스만 이 select 를 갈아끼운다(아래 "옵션 없는 상품" 케이스가 세운 선례와
  // 같은 깊이).
  const trx = {
    update: () => ({
      set: (values: { bulkSessionId: string | null }) => ({
        where: () => {
          calls.locked.push({ versionId: VERSION_ID, sessionId: values.bulkSessionId });
          return Promise.resolve();
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ variantId: 'v-old' }]),
      }),
    }),
  };

  const db = { run: <T>(fn: (t: never) => Promise<T>) => fn(trx as never) };

  const masters = {
    createMaster: () => Promise.resolve({ id: VERSION_ID, masterId: MASTER_ID }),
    updateVersion: (...args: unknown[]) => {
      calls.updateVersion.push(args);
      return Promise.resolve({ id: VERSION_ID, masterId: MASTER_ID });
    },
    ...overrides.masters,
  };
  const versions = {
    getActiveVersion: () => Promise.resolve({ id: 'active-1', masterId: MASTER_ID }),
    createDraftVersion: () => Promise.resolve({ id: VERSION_ID, masterId: MASTER_ID }),
    ...overrides.versions,
  };
  const variants = {
    bulkUpdateVariantsInDraft: (...args: unknown[]) => {
      calls.bulkUpdateVariantsInDraft.push(args);
      return Promise.resolve([]);
    },
    ...overrides.variants,
  };
  const optionLoader = {
    getOptionGroups: () => Promise.resolve([]),
    getVariantOptionValues: () => Promise.resolve([]),
    ...overrides.optionLoader,
  };
  const pricing = {
    getVersionRules: () => Promise.resolve({ basePriceRules: [], membershipPriceRules: [], tieredPriceRules: [] }),
    replaceVersionRules: (...args: unknown[]) => {
      calls.replaceVersionRules.push(args);
      return Promise.resolve({});
    },
    ...overrides.pricing,
  };
  const constraints = {
    upsertForDraft: (...args: unknown[]) => {
      calls.upsertForDraft.push(args);
      return Promise.resolve(null);
    },
    ...overrides.constraints,
  };

  const applier = new BulkDraftApplier(
    db as never,
    masters as never,
    versions as never,
    variants as never,
    optionLoader as never,
    pricing as never,
    constraints as never,
  );
  return { applier, calls, trx };
}

function createInput(fields: FlatFields): DraftInput {
  return {
    sessionId: SESSION_ID,
    userId: USER_ID,
    kind: 'create',
    masterId: null,
    payload: { fields },
    // 옵션 없는 상품이 기본값이다. 옵션이 있는 케이스는 행을 명시적으로 넘긴다.
    optionRows: [],
    // 조합 중복 검사(checkCreateStructure)의 입력. 검사 대상 케이스는 행을 명시적으로 넘긴다.
    variantRows: [],
    conflictDecision: {},
    baseSnapshot: null,
    images: { fileIdFor: () => undefined },
  };
}

describe('BulkDraftApplier — 신규 경로', () => {
  it('master 를 만들고 스칼라를 updateVersion 으로 넘긴다', async () => {
    const { applier, calls, trx } = makeApplier();

    const result = await applier.apply(
      createInput({ 'product.name': '반팔티', 'product.basePrice': '10000' }),
      trx as never,
    );

    expect(result).toEqual({ draftVersionId: VERSION_ID, masterId: MASTER_ID });
    expect(calls.updateVersion).toHaveLength(1);
    expect(calls.updateVersion[0][1]).toMatchObject({ name: '반팔티' });
  });

  it('판매가를 all_variants override 룰로 만든다', async () => {
    const { applier, calls, trx } = makeApplier();

    await applier.apply(createInput({ 'product.name': 'T', 'product.basePrice': '10000' }), trx as never);

    expect(calls.replaceVersionRules).toHaveLength(1);
    expect(calls.replaceVersionRules[0][1]).toMatchObject({
      basePriceRules: [
        { layer: 'base_price', order: 1, scopeType: 'all_variants', operationType: 'override', operationValue: 10000 },
      ],
    });
  });

  it('draft 에 bulk_session_id 를 심는다', async () => {
    const { applier, calls, trx } = makeApplier();

    await applier.apply(createInput({ 'product.name': 'T', 'product.basePrice': '10000' }), trx as never);

    expect(calls.locked).toEqual([{ versionId: VERSION_ID, sessionId: SESSION_ID }]);
  });

  it('옵션 구조 오류는 BadRequestError 로 그 행만 실패시킨다', async () => {
    const { applier, trx } = makeApplier();

    // 조합이 옵션 시트에 없는 옵션값키를 가리킨다 (F8 이 지적한 무검증 구멍).
    await expect(
      applier.apply(
        createInput({ 'product.name': 'T', 'product.basePrice': '10000', 'variant:없는키.basePrice': '1' }),
        trx as never,
      ),
    ).rejects.toThrow('없는키');
  });

  it('구매제약 칸이 없으면 upsertForDraft 를 부르지 않는다', async () => {
    const { applier, calls, trx } = makeApplier();

    await applier.apply(createInput({ 'product.name': 'T', 'product.basePrice': '10000' }), trx as never);

    expect(calls.upsertForDraft).toEqual([]);
  });

  // 추가 케이스 (2026-08-03 리뷰): 옵션 없는 상품의 variant 오버라이드는 빈 combination
  // 문자열('')을 쓴다는 계약(form-export.snapshot.reader.ts:263-271)이 resolveCreatedCombos
  // 에서도 지켜지는지 확인한다. 안 지켜지면 옵션 없는 신규 상품의 조합별 가격이 통째로
  // 사라져도 어떤 테스트도 잡지 못한다.
  it("옵션 없는 상품도 빈 조합키('')로 variant 단위 가격 오버라이드를 건다", async () => {
    const { applier, calls, trx: baseTrx } = makeApplier();
    const SOLE_VARIANT_ID = '0198f000-0000-7000-8000-000000000099';

    // resolveCreatedCombos 가 옵션 없는 상품의 유일한 variant 를 조회할 수 있도록
    // productMasterVariants 목록 조회만 흉내 낸다. 이 select 는 fields 에 variant: 스코프
    // 키가 있을 때만 타므로(그 외 케이스는 select 자체를 안 쓴다), 위 5개 케이스의 fake trx
    // 는 select 없이도 그대로 통과한다.
    const trx = {
      ...baseTrx,
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{ variantId: SOLE_VARIANT_ID }]),
        }),
      }),
    };

    await applier.apply(
      createInput({
        'product.name': 'T',
        'product.basePrice': '10000',
        'variant:.basePrice': '9000',
      }),
      trx as never,
    );

    expect(calls.replaceVersionRules).toHaveLength(1);
    expect(calls.replaceVersionRules[0][1]).toMatchObject({
      basePriceRules: [
        { layer: 'base_price', order: 1, scopeType: 'all_variants', operationType: 'override', operationValue: 10000 },
        {
          layer: 'base_price',
          order: 2,
          scopeType: 'variants',
          scopeTargetIds: [SOLE_VARIANT_ID],
          operationType: 'override',
          operationValue: 9000,
        },
      ],
    });
  });
});

/** 옵션 없는 상품 하나짜리 스냅샷. `combination` 이 빈 문자열인 것이 계약이다(F3). */
function updateInput(fields: FlatFields, overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    sessionId: SESSION_ID,
    userId: USER_ID,
    kind: 'update',
    masterId: MASTER_ID,
    payload: { fields },
    // 수정 행은 옵션 구조를 못 바꾸므로 이 배열을 쓰지 않는다(그룹 귀속은 DB 에서 읽는다).
    optionRows: [],
    // 수정 행은 checkCreateStructure(신규 행 전용)를 타지 않으므로 이 배열도 쓰지 않는다.
    variantRows: [],
    conflictDecision: {},
    baseSnapshot: {
      product: {},
      options: [],
      variants: [{ combination: '', variantCode: 'OLD' }],
      categories: [],
      constraint: null,
      images: {},
      pricingEditable: true,
    },
    images: { fileIdFor: () => undefined },
    ...overrides,
  };
}

describe('BulkDraftApplier — 수정 경로', () => {
  it('현재 active 에서 포크한다 — 스냅샷 버전이 아니라', async () => {
    // §3.6 병합 설계의 전부가 이 한 줄이다. 스냅샷에서 포크하면 그 사이 남이 발행한 변경이
    // 이 draft 가 발행되는 순간 통째로 사라진다(publishVersion 은 통째 교체 — 스펙 §2.2).
    const forkedFrom: string[] = [];
    const { applier, trx } = makeApplier({
      versions: {
        getActiveVersion: () => Promise.resolve({ id: ACTIVE_ID, masterId: MASTER_ID }),
        createDraftVersion: (parentVersionId: string) => {
          forkedFrom.push(parentVersionId);
          return Promise.resolve({ id: VERSION_ID, masterId: MASTER_ID });
        },
      },
    });

    await applier.apply(updateInput({ 'product.brand': 'ACME' }), trx as never);

    expect(forkedFrom).toEqual([ACTIVE_ID]);
  });

  it("conflict_decision 이 'skip' 인 필드는 적용하지 않는다", async () => {
    const { applier, calls, trx } = makeApplier();

    await applier.apply(
      updateInput(
        { 'product.brand': 'BETA', 'product.name': '새 이름' },
        { conflictDecision: { 'product.brand': 'skip' } },
      ),
      trx as never,
    );

    const data = calls.updateVersion[0][1] as Record<string, unknown>;
    expect(data.name).toBe('새 이름');
    expect('brand' in data).toBe(false);
  });

  it('variant 편집은 bulkUpdateVariantsInDraft 로 간다', async () => {
    // 페이크에는 productVariants 직접 UPDATE 경로가 없다 — 그 방식으로 회귀하면 여기서 죽는다.
    const updates: unknown[] = [];
    const { applier, trx } = makeApplier({
      variants: {
        bulkUpdateVariantsInDraft: (_m: string, _v: string, args: unknown[]) => {
          updates.push(...args);
          return Promise.resolve([{ originalId: 'v-old', variantId: 'v-old', cowed: false }]);
        },
      },
    });

    await applier.apply(updateInput({ 'variant:.variantCode': 'NEW-CODE' }), trx as never);

    expect(updates).toEqual([{ id: 'v-old', variantCode: 'NEW-CODE' }]);
  });

  it('CoW 로 바뀐 variantId 로 가격 룰을 만든다', async () => {
    // (Fix round 1, Important 1) 이 케이스는 "CoW 먼저, 가격 읽기 나중" 이라는 순서를 고정한다.
    // 프로덕션에서는 bulkUpdateVariantsInDraft 내부의 CoW 캐스케이드(_cascadeVariantCoWToPricingRules,
    // product-variants.service.ts:503)가 draft 의 기존 조합 오버라이드 룰(scopeTargetIds
    // 에 old variantId)을 **같은 트랜잭션 안에서** new variantId 로 이미 리포인트해 둔다 — 그래서
    // 올바른 순서(CoW 다음 읽기)에서는 getVersionRules 가 이미 new id 로 리포인트된 룰을 본다.
    // 이 사실을 페이크로 흉내 내려면 정적 스텁으로는 안 된다(호출 시점을 모른다) — CoW 가
    // 이미 일어났는지를 반영하는 상태 기반 스텁을 쓴다. 순서가 뒤집혀 가격을 CoW 전에
    // 읽으면 스텁이 아직 old id 로 스코프된 기존 룰을 돌려주고, 그 룰이 결과 DTO 에 그대로
    // 남아(v-old 가 살아있는 채로) 아래 두 번째 단정이 깨진다 — 그래서 이 테스트는 진짜로
    // 순서에 민감하다(정적 스텁이었다면 "룰이 하나도 없다"는 이전 실수처럼 항상 통과해
    // 공허했을 것).
    let cowHappened = false;
    const { applier, calls, trx } = makeApplier({
      variants: {
        bulkUpdateVariantsInDraft: () => {
          cowHappened = true;
          return Promise.resolve([{ originalId: 'v-old', variantId: 'v-new', cowed: true }]);
        },
      },
      pricing: {
        getVersionRules: () =>
          Promise.resolve({
            basePriceRules: [
              {
                layer: 'base_price',
                order: 1,
                scopeType: 'all_variants',
                operationType: 'override',
                operationValue: 10000,
              },
              {
                layer: 'base_price',
                order: 2,
                scopeType: 'variants',
                scopeTargetIds: [cowHappened ? 'v-new' : 'v-old'],
                operationType: 'override',
                operationValue: 9000,
              },
            ],
            membershipPriceRules: [],
            tieredPriceRules: [],
          }),
      },
    });

    await applier.apply(
      updateInput({ 'variant:.variantCode': 'NEW-CODE', 'variant:.basePrice': '15000' }),
      trx as never,
    );

    const dto = calls.replaceVersionRules[0][1] as { basePriceRules: Array<{ scopeTargetIds?: string[] }> };
    expect(dto.basePriceRules.some((r) => r.scopeTargetIds?.includes('v-new'))).toBe(true);
    expect(dto.basePriceRules.some((r) => r.scopeTargetIds?.includes('v-old'))).toBe(false);
  });

  it('가격 칸을 안 건드린 행은 replaceVersionRules 를 부르지 않는다', async () => {
    // Task 5 리뷰가 남긴 ⚠️: toReplaceDto 는 basePrice 가 null 이면 항상 throw 한다. 브랜드만
    // 고친 행에서 가격 replace 를 부르면, all_variants 판매가 룰이 없는 상품에서 가격과 무관한
    // 수정이 통째로 실패한다. 안 부르는 것이 옳고, `_copyMappings` 가 복사한 룰이 이미 정답이다.
    const { applier, calls, trx } = makeApplier();

    await applier.apply(updateInput({ 'product.brand': 'ACME' }), trx as never);

    expect(calls.replaceVersionRules).toEqual([]);
  });

  it('pricingEditable=false 면 가격 칸을 건드려도 replaceVersionRules 를 부르지 않는다', async () => {
    // _copyMappings 가 복사한 복합 룰(tiered·scale 등)이 그대로 살아 있어야 한다. 부르는 순간
    // replace 가 그것을 단순 override 로 뭉갠다(F9).
    //
    // **가격 칸을 실제로 건드리는 입력이어야 한다** — 위 테스트가 이미 "안 건드리면 안 부른다"를
    // 덮으므로, 여기서 브랜드만 바꾸면 두 테스트가 같은 경로를 보고 pricingEditable 분기는
    // 아무도 검증하지 않게 된다. (실전에서 이 조합은 센티넬 훼손 행이라 2단계 검증기가 이미
    // invalid 로 걸러내지만, 이 단정은 applier 가 스스로 막는다는 것을 고정한다.)
    const { applier, calls, trx } = makeApplier();
    const input = updateInput({ 'product.basePrice': '12000' });
    input.baseSnapshot = { ...input.baseSnapshot!, pricingEditable: false };

    await applier.apply(input, trx as never);

    expect(calls.replaceVersionRules).toEqual([]);
  });

  it('찾지 못한 옵션값 id 는 행 오류다 — 수정 행은 옵션값 추가가 금지된다', async () => {
    // buildOptionModify 가 값 스코프 항목을 optionGroupId: '' 로 남기면 attachGroupIds 가
    // getOptionGroups 로 실제 소속을 채운다. 기본 페이크는 옵션이 하나도 없는 상품을
    // 흉내 내므로(getOptionGroups: () => []), 어떤 optionValueId 를 조회해도 못 찾는다 —
    // 데이터가 어긋난 것이므로 조용히 넘기지 않고 행 오류로 던져야 한다.
    const { applier, trx } = makeApplier();

    await expect(
      applier.apply(updateInput({ 'optionValue:ov-1.optionValueName': '새이름' }), trx as never),
    ).rejects.toThrow('ov-1');
  });

  it('한도만 고친 수정 행이 멤버십필요를 해제하지 않는다', async () => {
    // (Fix round 1, Critical) 수정 행의 fields 는 변경분만 담는다(computeChanges) — 한도만
    // 고치면 'constraint.requiresMembership' 키 자체가 fields 에 없다. 두 축을 신규 경로처럼
    // 한 덩어리로 읽어 없는 축을 "false" 로 채우면, 멤버십 전용 상품이 한도 수정 한 번으로
    // 비회원도 살 수 있게 조용히 풀린다 — 발행 후에나 발견되는 사고.
    const { applier, calls, trx } = makeApplier({
      constraints: {
        getForVersion: () => Promise.resolve({ id: 'pc-1', requiresMembership: true, lifetimeQuantityLimit: 3 }),
      },
    });

    await applier.apply(updateInput({ 'constraint.lifetimeQuantityLimit': '5' }), trx as never);

    expect(calls.upsertForDraft[0][2]).toEqual({ requiresMembership: true, lifetimeQuantityLimit: 5 });
  });

  it('멤버십필요만 고친 수정 행이 평생구매한도를 지우지 않는다', async () => {
    // (Fix round 1, Critical) 지금 이 가드가 없으면 dto 가 {requiresMembership:false,
    // lifetimeQuantityLimit:null} 이 되어 isDeleteIntent(product-purchase-constraints.service.ts:32-34)
    // 에 걸리고, upsertForDraft 내부에서 구매제약 행 자체가 삭제된다 — 한도까지 함께
    // 사라지는 사고.
    const { applier, calls, trx } = makeApplier({
      constraints: {
        getForVersion: () => Promise.resolve({ id: 'pc-1', requiresMembership: true, lifetimeQuantityLimit: 3 }),
      },
    });

    await applier.apply(updateInput({ 'constraint.requiresMembership': 'N' }), trx as never);

    expect(calls.upsertForDraft[0][2]).toEqual({ requiresMembership: false, lifetimeQuantityLimit: 3 });
  });
});
