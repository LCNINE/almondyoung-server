import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { MedusaError } from '@medusajs/framework/utils';
import {
  isSaleKey,
  MAX_PRODUCT_PERIOD_GROUPS,
  repeatTooShortFor,
  type SaleDisplay,
} from '../../../../../../../packages/domain-types/time-sale';
import { respondConflictWithMessage } from '../conflict';
import { clearTimeSaleProductCache, revalidateTimeSaleCache } from '../../../../utils/time-sale-settings';
import {
  saveTimeSaleWorkflow,
  type TimeSaleGroup,
  type TimeSalePriceListPayload,
} from '../../../../workflows/time-sale/save-time-sale';

type SaveBody = {
  saleId?: unknown;
  periodMode?: unknown;
  products?: unknown;
  generalId?: unknown;
  membershipId?: unknown;
  title?: unknown;
  period?: { startsAt?: unknown; endsAt?: unknown };
  general?: unknown;
  membership?: unknown;
  display?: unknown;
  revision?: unknown;
  status?: unknown;
};

const invalid = (message: string) => new MedusaError(MedusaError.Types.INVALID_DATA, message);

// 요청 본문 검증 헬퍼들: 형식이 틀리면 INVALID_DATA(400).
const optionalId = (value: unknown, name: string): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !value) throw invalid(`${name} 은 문자열이어야 합니다.`);
  return value;
};

const isPrice = (value: unknown) => {
  if (!value || typeof value !== 'object') return false;
  const price = value as Record<string, unknown>;

  return (
    typeof price.amount === 'number' &&
    Number.isFinite(price.amount) &&
    price.amount > 0 &&
    typeof price.currency_code === 'string' &&
    typeof price.variant_id === 'string'
  );
};

const toPayload = (value: unknown, name: string): TimeSalePriceListPayload | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') throw invalid(`${name} 가격표 형식이 잘못되었습니다.`);

  const payload = value as Record<string, unknown>;
  const rules = payload.rules;
  if (!Array.isArray(payload.prices) || !payload.prices.every(isPrice))
    throw invalid(`${name} 가격표의 prices 를 확인하세요.`);
  if (!rules || typeof rules !== 'object' || Array.isArray(rules))
    throw invalid(`${name} 가격표의 rules 를 확인하세요.`);

  return {
    description: typeof payload.description === 'string' ? payload.description : '',
    rules: rules as Record<string, string[]>,
    prices: payload.prices as TimeSalePriceListPayload['prices'],
  };
};

type Period = { startsAt: string; endsAt: string };

const toPeriod = (startsAt: unknown, endsAt: unknown): Period | null => {
  if (typeof startsAt !== 'string' || typeof endsAt !== 'string') return null;
  if (!(Date.parse(startsAt) < Date.parse(endsAt))) return null;

  return { startsAt, endsAt };
};

// 상품별 기간 모드: products 를 상품당 그룹 하나로 바꾼다(상한
// 200개, 상품 중복 불가, 개별 기간이 없으면 세일 기간 사용).
const toProductGroups = (value: unknown, period: Period): TimeSaleGroup[] => {
  if (!Array.isArray(value) || value.length === 0) throw invalid('상품별 기간을 입력할 상품이 없습니다.');
  if (value.length > MAX_PRODUCT_PERIOD_GROUPS) throw invalid('상품별 기간은 상품 200개까지입니다.');

  const groups = value.map((item: unknown) => {
    const product = (item ?? {}) as { productId?: unknown; startsAt?: unknown; endsAt?: unknown };
    if (typeof product.productId !== 'string' || !product.productId) throw invalid('상품 id 를 확인하세요.');

    const own = toPeriod(product.startsAt ?? period.startsAt, product.endsAt ?? period.endsAt);
    if (!own) throw invalid(`상품 ${product.productId} 의 기간을 확인하세요.`);

    return { generalId: null, membershipId: null, productId: product.productId, ...own };
  });

  if (new Set(groups.map((group) => group.productId)).size !== groups.length)
    throw invalid('상품별 기간은 상품마다 하나씩입니다.');

  return groups;
};

// 타임세일 저장(생성·수정 공통). 본문 검증 → 워크플로 실행 → 스토어프론트 캐시 무효화.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as SaveBody;
  const period = toPeriod(body.period?.startsAt, body.period?.endsAt);

  if (typeof body.title !== 'string' || !body.title.trim()) throw invalid('세일 이름을 입력하세요.');
  if (!period) throw invalid('세일 기간을 확인하세요.');
  if (body.periodMode !== undefined && body.periodMode !== 'sale' && body.periodMode !== 'product')
    throw invalid('periodMode 는 sale 또는 product 여야 합니다.');
  if (body.saleId !== undefined && body.saleId !== null && (typeof body.saleId !== 'string' || !isSaleKey(body.saleId)))
    throw invalid('saleId 를 확인하세요.');
  if (typeof body.revision !== 'string') throw invalid('revision 은 문자열이어야 합니다.');
  if (!body.display || typeof body.display !== 'object') throw invalid('display 를 확인하세요.');
  if (body.status !== undefined && body.status !== 'active' && body.status !== 'draft')
    throw invalid('status 는 active 또는 draft 여야 합니다.');

  // 1) 일반·멤버십 가격표 검증(둘 다 비면 거절)
  const general = toPayload(body.general, '일반');
  const membership = toPayload(body.membership, '멤버십');
  if (!general?.prices.length && !membership?.prices.length) throw invalid('세일가를 입력한 품목이 없습니다.');

  // 2) 기간 모드에 맞춰 그룹 구성: 상품별이면 상품마다, 아니면 세일 전체 그룹 1개
  const title = body.title.trim();
  const revision = body.revision;
  const periodMode = body.periodMode === 'product' ? 'product' : 'sale';
  const groups: TimeSaleGroup[] =
    periodMode === 'product'
      ? toProductGroups(body.products, period)
      : [
          {
            generalId: optionalId(body.generalId, 'generalId'),
            membershipId: optionalId(body.membershipId, 'membershipId'),
            productId: null,
            ...period,
          },
        ];
  const display = body.display as SaleDisplay;
  // 반복 간격은 기간보다 10분 이상 길어야 한다(다음 회차가 현재 회차와 겹치지 않게).
  const tooShort = repeatTooShortFor(Number(display.repeatHours) || 0, groups);
  if (tooShort) {
    const target = tooShort.productId ? `상품 ${tooShort.productId} 의 기간` : '세일 기간';
    throw invalid(`반복 간격은 ${target}보다 10분 이상 길어야 합니다.`);
  }

  // 3) 저장 워크플로(락·겹침 검사 포함). 겹치면 409.
  const saved = await respondConflictWithMessage(res, () =>
    saveTimeSaleWorkflow(req.scope).run({
      input: {
        saleId: typeof body.saleId === 'string' ? body.saleId : null,
        periodMode,
        groups,
        title,
        general,
        membership,
        display,
        revision,
        status: body.status === 'draft' ? 'draft' : 'active',
      },
    }),
  );
  if (!saved.ok) return;

  // 4) 세일에서 빠진 상품까지 포함해 상품 캐시를 비운다(Ruling 22).
  const { productIds, ...result } = saved.value.result;
  await clearTimeSaleProductCache(req.scope, productIds);
  await revalidateTimeSaleCache(req.scope);

  return res.json(result);
}
