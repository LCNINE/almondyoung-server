/**
 * 쿠폰 생성 페이로드 ↔ Medusa 검증기 계약 가드 (#488 F1 Task 2).
 *
 * **왜 유닛으로는 부족한가.** 빌더 유닛 스펙이 증명하는 것은 「우리 타입에 맞는 객체가 나오는가」
 * 까지다. Medusa 의 생성 검증기는 `.strict()` + refine 이라 **우리 타입에 없는 필드**를 요구할 수
 * 있고, 그때 유닛은 전부 초록인 채로 런타임 400 이 난다. 실제로 그렇게 됐다 — 폼에서 고를 수 있는
 * 「배송비 할인」이 `allocation` 누락으로 100% 실패하는 상태가 유닛 17건을 통과했다.
 *
 * **왜 «조합»이 아니라 «축»인가.** 리허설 1차는 이 위험을 겨냥해 실물 3발을 쐈지만 셋 다
 * `target_type: 'order'` 라 `allocation` 축을 지나가지 않았다. 조합을 손으로 고르면 고른 사람의
 * 가정이 그대로 사각지대가 된다. 그래서 여기서는 **폼이 낼 수 있는 값의 축을 전수 발사**한다 —
 * 폼에 새 축이 생기면 아래 배열에 값을 더하는 것으로 커버리지가 따라온다.
 *
 * 실행 (로컬 Medusa 필요, 절차는 docs/local-dev.md 「전체 스택 로컬 구동」):
 *   MEDUSA_ADMIN_URL=http://localhost:9000 \
 *   MEDUSA_ADMIN_TOKEN=$(curl -s -X POST http://localhost:9000/auth/user/emailpass \
 *     -H 'content-type: application/json' -d '{"email":"...","password":"..."}' | jq -r .token) \
 *   npm run test:admin-web -- --testPathPattern=build-create-promotion-payload.integration
 *
 * 두 env 중 하나라도 없으면 통째로 skip 된다 — 기본 게이트를 빨갛게 만들지 않기 위해서다.
 */
import {
  buildCreatePromotionPayload,
  type CouponFormState,
  type TargetAttribute,
} from './build-create-promotion-payload';

const MEDUSA_ADMIN_URL = process.env.MEDUSA_ADMIN_URL;
const MEDUSA_ADMIN_TOKEN = process.env.MEDUSA_ADMIN_TOKEN;
const describeIfMedusa = MEDUSA_ADMIN_URL && MEDUSA_ADMIN_TOKEN ? describe : describe.skip;

/** 폼이 낼 수 있는 축. 폼에 값이 늘면 여기에 더한다. */
const TARGET_TYPES = ['order', 'items', 'shipping_methods'] as const;
const DISCOUNT_TYPES = ['fixed', 'percentage'] as const;
/**
 * 한도 축. 1인당 한도(use_by_attribute)는 #488 Task 13 에서 제거됐다 —
 * 1장 = 1회는 이제 `coupon_grant` 가 구조적으로 강제하므로, 전역 한도(promotion.limit)와
 * 총 할인금액 한도(campaign budget)만 남는다. 둘은 서로 다른 슬롯이라 자유롭게 공존한다.
 */
const LIMIT_AXIS = [
  { key: '한도없음', patch: {} },
  { key: '전역한도', patch: { usageLimit: 100 } },
  { key: '총할인금액', patch: { spendLimit: 500_000 } },
] as const satisfies readonly { key: string; patch: Partial<CouponFormState> }[];

const baseForm: CouponFormState = {
  code: '',
  name: '축 전수 가드',
  discountType: 'percentage',
  value: 10,
  maxDiscountAmount: '',
  targetType: 'order',
  targetAttribute: 'product_id' as TargetAttribute,
  targetItemIds: [],
  minOrderAmount: '',
  customerGroupIds: [],
  startsAt: '',
  endsAt: '',
  validityDays: '',
  usageLimit: '',
  spendLimit: '',
  maxClaims: '',
  visibility: 'public',
  autoIssueTrigger: '',
  createdBy: 'axis-guard@local.test',
};

type CreatedPromotion = {
  id: string;
  application_method: {
    type: string;
    value: number;
    target_type: string;
    allocation: string | null;
    currency_code: string | null;
  };
};

async function medusa(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${MEDUSA_ADMIN_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${MEDUSA_ADMIN_TOKEN}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

describeIfMedusa('생성 페이로드가 Medusa 검증기를 통과한다 (축 전수)', () => {
  jest.setTimeout(120_000);

  const runId = Date.now().toString(36).toUpperCase();
  const created: string[] = [];

  afterAll(async () => {
    // 남기면 다음 실행의 code unique 와 부딪히진 않지만(runId 로 갈림) 로컬이 지저분해진다.
    for (const id of created) {
      await medusa(`/admin/promotions/${id}`, { method: 'DELETE' }).catch(() => undefined);
    }
  });

  const cases = TARGET_TYPES.flatMap((targetType) =>
    DISCOUNT_TYPES.flatMap((discountType) =>
      LIMIT_AXIS.map((limit) => ({
        label: `${targetType} × ${discountType} × ${limit.key}`,
        form: {
          ...baseForm,
          ...limit.patch,
          targetType,
          discountType,
          // items 대상은 타깃이 최소 1개 있어야 룰이 만들어진다. 존재하지 않는 id 여도
          // 생성 검증은 통과한다 — 여기서 보는 것은 «엔진이 이 페이로드를 받는가» 뿐이다.
          targetItemIds: targetType === 'items' ? [`prod_axis_guard_${runId}`] : [],
        } satisfies CouponFormState,
      })),
    ),
  );

  it.each(cases)('$label', async ({ label, form }) => {
    const code = `AXIS${runId}${cases.findIndex((c) => c.label === label)}`;
    const payload = buildCreatePromotionPayload({ ...form, code }, { campaignSuffix: runId });

    const res = await medusa('/admin/promotions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as { promotion?: CreatedPromotion; message?: string };

    expect({ label, status: res.status, message: body.message }).toEqual({
      label,
      status: 200,
      message: undefined,
    });

    const promotion = body.promotion!;
    created.push(promotion.id);

    // 엔진이 받아준 것으로 끝내지 않는다 — 보낸 값이 그대로 저장됐는지까지 본다.
    // (검증기를 통과하고도 조용히 다른 값으로 저장되면 관리자 의도와 어긋난다.)
    const am = promotion.application_method;
    expect(am.type).toBe(payload.application_method.type);
    expect(am.value).toBe(payload.application_method.value);
    expect(am.target_type).toBe(payload.application_method.target_type);
    expect(am.allocation ?? undefined).toBe(payload.application_method.allocation);
    expect(am.currency_code ?? undefined).toBe(payload.application_method.currency_code);
  });
});
