import { parentOf } from '../auth/screen-access';

export type PiiScreenOpens = 'customer' | 'recipient';

export interface PiiScreen {
  readonly opens: PiiScreenOpens;
  readonly reveal?: true;
  /** [보기]가 화면 안에서 여는 상세만 원문으로 다시 받는다 — 목록 등 나머지 개인정보는 가려진 채 남는다. 없으면 화면 전체. */
  readonly revealScope?: 'detail';
  /** 이 화면이 그리는 개인정보가 모두 받는 분 정보 권한으로도 열린다 — 그 권한자에게는 전부 원문이다. */
  readonly recipientCoversAll?: true;
}

/** 화면 표 — `null` 은 «안내 없음»: 같은 깊이의 `[id]` 키나 상위 키에 걸리지 않게 막는다. */
export type PiiScreenTable = Readonly<Record<string, PiiScreen | null>>;

const CUSTOMER: PiiScreen = { opens: 'customer' };
const CUSTOMER_DETAIL: PiiScreen = { opens: 'customer', reveal: true };
const CUSTOMER_MIXED: PiiScreen = {
  opens: 'customer',
  reveal: true,
  revealScope: 'detail',
};
const RECIPIENT_ALL: PiiScreen = {
  opens: 'recipient',
  recipientCoversAll: true,
};
const RECIPIENT_ALL_DETAIL: PiiScreen = {
  opens: 'recipient',
  reveal: true,
  recipientCoversAll: true,
};
const RECIPIENT_ALL_MIXED: PiiScreen = {
  ...RECIPIENT_ALL_DETAIL,
  revealScope: 'detail',
};

/**
 * 개인정보를 응답하는 API 를 부르는 화면 — `pii-screens.gate.spec.ts` 가 import 를 따라가 빠진 화면을 찾는다.
 * 값은 게이트가 그 화면이 닿는 개인정보 조회 경로로 검사한다 — `recipient` 는 받는 분 정보 권한으로도 열리는 경로
 * (`PII_RECIPIENT_ROUTES`)에 닿는 화면, `recipientCoversAll` 은 그런 경로에만 닿는 화면, `reveal` 은 화면 안의 상세·패널을
 * 포함해 [보기]로 원문을 다시 받는 경로(`PII_REVEAL_ROUTES`)에 닿는 화면, `revealScope: 'detail'` 은 그 밖의 개인정보
 * 경로에도 닿는 화면이다.
 */
const SHOWN: Readonly<Record<string, PiiScreen>> = {
  // 운영 현황의 검색어 담당자 고르기가 직원 목록을 받는다
  '/': CUSTOMER,

  '/account/blacklist': CUSTOMER,
  '/account/customer': CUSTOMER,
  '/account/sales-channel/medusa-customers': CUSTOMER,
  '/account/sales-channel/medusa-customers/[id]': CUSTOMER_DETAIL,
  '/customer-window/[id]': CUSTOMER_MIXED,

  // 주문 조회 패널이 판매주문 상세를 연다 — 하위 화면은 상세 [보기]를 물려받지 않게 따로 적는다
  '/cs': CUSTOMER_MIXED,
  '/cs/business-licenses': CUSTOMER,
  '/cs/business-licenses/[id]': CUSTOMER_DETAIL,
  '/cs/qna': CUSTOMER,
  // 작성자 이름을 회원 상세로 받는다
  '/cs/qna/[id]': CUSTOMER_DETAIL,
  '/cs/return-exchange': CUSTOMER,
  '/cs/reviews': CUSTOMER,
  '/cs/reviews/[id]': CUSTOMER_DETAIL,

  '/logo-contest': CUSTOMER_DETAIL,
  '/mall/almond-templates': CUSTOMER_DETAIL,
  '/mall/audit': CUSTOMER,
  '/mall/channel-listings': CUSTOMER,
  '/mall/marketing/coupons': CUSTOMER_MIXED,
  // 등록자 고르기가 직원 목록을 받는다
  '/mall/products-list': CUSTOMER,
  '/mall/shop-listings': CUSTOMER,
  '/mall/shop-listings/[id]': CUSTOMER_MIXED,

  '/membership/cancellations': CUSTOMER_MIXED,
  '/membership/collections': CUSTOMER_MIXED,
  '/membership/members': CUSTOMER_MIXED,
  '/membership/recurring-billing': CUSTOMER_MIXED,

  '/messages/alimtalk/campaigns': CUSTOMER,
  '/messages/campaigns': CUSTOMER,
  // 대화 목록 옆에 대화 상세를 연다
  '/messages/inbox': CUSTOMER_MIXED,
  '/messages/send': CUSTOMER,

  '/order/consolidation': RECIPIENT_ALL,
  '/order/direct-ship': RECIPIENT_ALL,
  '/order/fulfillments': RECIPIENT_ALL_MIXED,
  '/order/inspection': RECIPIENT_ALL_DETAIL,
  '/order/picking-list': RECIPIENT_ALL_MIXED,
  '/order/stall-board': RECIPIENT_ALL,
  '/order/waybill-issue': RECIPIENT_ALL,
  '/order/history': CUSTOMER_MIXED,
  '/order/manual-single': CUSTOMER_MIXED,
  '/order/matching': CUSTOMER,
  '/order/print-orders': CUSTOMER,
  '/order/regional-invoice': CUSTOMER,

  '/payments': CUSTOMER_MIXED,
  '/payments/points': CUSTOMER,
  '/payments/refund-requests': CUSTOMER,

  '/statistics/keywords': CUSTOMER,
  '/users': CUSTOMER,
  '/users/[id]': CUSTOMER_DETAIL,
};

/**
 * 안내를 띄우지 않는 화면 → 사유. 개인정보 API 를 부르지만 그리지 않는 화면(만들기 폼·건수 타일)과, 위 표의 상위 키나
 * 같은 깊이 `[id]` 키를 물려받으면 안 되는 화면을 적는다. 게이트가 사유 없는 줄·죽은 줄을 막는다.
 */
const SIBLING_PAYMENT =
  '결제 상세 [id] 와 다른 페이지이고 개인정보 API 를 부르지 않는다';
const SIBLING_USER =
  '직원 상세 [id] 와 다른 페이지이고 개인정보 API 를 부르지 않는다';

export const PII_SCREEN_NOT_SHOWN: Readonly<Record<string, string>> = {
  '/cs/management': '메뉴 배지에 건수만 센다',
  '/cs/purchase-satisfaction': '만족도 응답 API 는 개인정보를 응답하지 않는다',
  '/cs/reviews/new': '새로 입력하는 만들기 폼이다',
  '/cs/reviews/rewards':
    '리뷰 상세 [id] 와 다른 페이지이고 개인정보 API 를 부르지 않는다',
  '/mall/products-list/[masterId]': '상품 상세 — 등록자 고르기가 없다',
  '/mall/shop-listings/new': '새로 입력하는 만들기 폼이다',
  '/order/manual-bulk': '주문 등록만 부르고 주문 목록·상세를 그리지 않는다',
  '/order/outbound-batches':
    '상자를 넣고 빼는 쓰기만 부르고 받는 분 정보를 응답에서 그리지 않는다',
  '/payments/methods': SIBLING_PAYMENT,
  '/payments/refunds': SIBLING_PAYMENT,
  '/payments/regions': SIBLING_PAYMENT,
  '/statistics/overview': '운영 현황 타일에 건수만 그린다',
  '/users/audit-log': SIBLING_USER,
  '/users/pii-access-log': SIBLING_USER,
  '/users/roles': SIBLING_USER,
};

export const PII_SCREENS: PiiScreenTable = {
  ...SHOWN,
  ...Object.fromEntries(
    Object.keys(PII_SCREEN_NOT_SHOWN).map((route) => [route, null])
  ),
};

const isDynamic = (segment: string) => segment.startsWith('[');

/** 이 경로에 맞는 키의 값. 맞는 키가 없으면 undefined(상위로 올라간다). */
function matchKey(
  table: PiiScreenTable,
  route: string
): PiiScreen | null | undefined {
  if (Object.hasOwn(table, route)) return table[route];
  const parts = route.split('/');
  let best: PiiScreen | null | undefined;
  let bestLiterals = -1;
  for (const key of Object.keys(table)) {
    const keyParts = key.split('/');
    if (keyParts.length !== parts.length) continue;
    let literals = 0;
    const fits = keyParts.every((segment, i) => {
      if (isDynamic(segment)) return true;
      literals += 1;
      return segment === parts[i];
    });
    if (fits && literals > bestLiterals) {
      best = table[key];
      bestLiterals = literals;
    }
  }
  return best;
}

export function resolvePiiScreenIn(
  table: PiiScreenTable,
  route: string
): PiiScreen | null {
  for (let at: string | null = route; at !== null; at = parentOf(at)) {
    const found = matchKey(table, at);
    if (found !== undefined) return found;
  }
  return null;
}

export function resolvePiiScreen(route: string): PiiScreen | null {
  return resolvePiiScreenIn(PII_SCREENS, route);
}

export type StandingNotice = {
  readonly text: string;
  readonly showReveal: boolean;
} | null;

const TEXT = {
  noPermission:
    '이 화면의 개인정보는 가려져 보입니다 — 개인정보 보기 권한이 없습니다.',
  recipientOnly:
    '이 화면의 개인정보 일부가 가려져 보입니다 — 받는 분 정보만 볼 수 있는 권한입니다.',
  maskedDetail:
    '개인정보가 가려져 있습니다 — [보기]를 누르면 원문이 열리고 열람 기록이 남습니다.',
  maskedList:
    '개인정보가 가려져 있습니다 — 상세 화면에서 [보기]로 원문을 열 수 있습니다.',
  revealing:
    '원문 표시 중 — 이 화면을 떠나면 다시 가려집니다(열람 기록이 남습니다).',
  maskedMixed:
    '개인정보가 가려져 있습니다 — [보기]를 누르면 이 화면에서 여는 상세의 원문이 열리고 열람 기록이 남습니다.',
  revealingMixed:
    '상세 원문 표시 중 — 목록은 가려진 채로 보입니다. 이 화면을 떠나면 다시 가려집니다(열람 기록이 남습니다).',
};

/** [보기] 진행 — `pending` 은 원문 재조회가 끝나기 전(화면엔 아직 가린 값), `shown` 은 재조회 성공 뒤. */
export type RevealPhase = 'idle' | 'pending' | 'shown';

export type PiiNoticeStatus = 'loading' | 'ready' | 'error';

/**
 * 안내용 권한 상태 — 실패를 먼저 본다. 재조회가 실패해도 이전 권한 사본이 남는데, 그걸로 «권한 없음»을 단정하지 않는다.
 * (버튼 판정용 `usePermissions()` 은 이전 사본을 먼저 쓴다 — 안내만 다르게 판정한다.)
 */
export function piiNoticeStatus(query: {
  readonly isError: boolean;
  readonly data: unknown;
}): PiiNoticeStatus {
  if (query.isError) return 'error';
  return query.data ? 'ready' : 'loading';
}

export function standingPiiNotice(input: {
  status: PiiNoticeStatus;
  held: ReadonlySet<string>;
  screen: PiiScreen | null;
  revealRequired: boolean;
  reveal: RevealPhase;
}): StandingNotice {
  const { status, held, screen, revealRequired, reveal } = input;
  if (status !== 'ready' || !screen) return null;

  const recipientHolder = held.has('fulfillment.recipient.read');
  // 받는 분 정보 권한으로 열리는 값은 스위치와 무관하게 원문이 온다
  if (
    screen.opens === 'recipient' &&
    screen.recipientCoversAll &&
    recipientHolder
  )
    return null;

  if (!held.has('customer.pii.read')) {
    if (screen.opens === 'recipient' && recipientHolder) {
      return { text: TEXT.recipientOnly, showReveal: false };
    }
    return { text: TEXT.noPermission, showReveal: false };
  }

  if (!revealRequired) return null;
  if (!screen.reveal) return { text: TEXT.maskedList, showReveal: false };
  const detailOnly = screen.revealScope === 'detail';
  if (reveal === 'shown')
    return {
      text: detailOnly ? TEXT.revealingMixed : TEXT.revealing,
      showReveal: false,
    };
  return {
    text: detailOnly ? TEXT.maskedMixed : TEXT.maskedDetail,
    showReveal: reveal === 'idle',
  };
}
