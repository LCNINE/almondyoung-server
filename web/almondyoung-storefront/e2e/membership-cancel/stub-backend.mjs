/**
 * 멤버십 해지 UI E2E 용 스텁 백엔드.
 *
 * 실제 화면(서버 컴포넌트 + 서버 액션)이 부르는 API 만 최소로 흉내낸다. 스토어프론트는 로컬 모드에서
 * users=3000 / membership=3001 / wallet=5001 로 붙으므로, 그 포트에 이 스텁을 띄우면 실제 UI 를
 * 브라우저로 그대로 검증할 수 있다(백엔드 전체 스택을 띄우지 않고).
 *
 * 시나리오는 SCENARIO 환경변수로 고른다:
 *   recurring-withdrawal  정기결제 + 청약철회 창(즉시해지 선택 가능, 전액환불)
 *   recurring-no-refund   정기결제 + 환불 불가(해지예약만)
 *   annual-proration      연간 + 중도해지 정산(34,930원)
 *   scheduled             이미 해지 예약된 상태(배너 + 철회 버튼)
 *   one-time-scheduled    1회 결제의 해지 예약 — 철회 버튼 없이 그 이유를 안내해야 한다
 *   one-time              1회 결제(자동결제 없음)
 *   cms-manual            자동이체(CMS) — 즉시해지 시 계좌 입력 필요
 */
import { createServer } from 'node:http';

const SCENARIO = process.env.SCENARIO ?? 'recurring-withdrawal';
const USER_ID = 'e2e-user';
const TODAY = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const plus = (days) => iso(new Date(TODAY.getTime() + days * 86400000));

const MONTHLY = 4990;
const ANNUAL = 49900;

const TIER = { id: 'tier-1', code: 'MEMBERSHIP', name: null, priorityLevel: 1, createdAt: '', updatedAt: '' };
const plan = (price, durationDays) => ({
  id: durationDays === 30 ? 'plan-monthly' : 'plan-annual',
  tierId: TIER.id,
  price,
  currency: 'KRW',
  durationDays,
  trialDays: 0,
  isActive: true,
  createdAt: '',
  updatedAt: '',
  tier: TIER,
});

/** 시나리오별 구독 상태 + 해지 미리보기 */
function build() {
  const endsAt = plus(28);
  const base = {
    id: 'contract-1',
    userId: USER_ID,
    planId: 'plan-monthly',
    status: 'ACTIVE',
    autoRenewal: true,
    pausedAt: null,
    recurringCancelledAt: null,
    paymentActionNeeded: false,
    startDate: plus(-2),
    endDate: endsAt,
    currentPeriodStart: plus(-2),
    currentPeriodEnd: endsAt,
    billingDate: plus(-2),
    nextBillingDate: endsAt,
    createdAt: '',
    updatedAt: '',
    plan: plan(MONTHLY, 30),
    tier: TIER,
  };

  const atPeriodEnd = {
    mode: 'AT_PERIOD_END',
    available: true,
    refundAmount: 0,
    refundKind: 'NONE',
    refundExecution: 'NONE',
    requiresReceiveAccount: false,
    effectiveEndsAt: endsAt,
  };
  const previewBase = {
    contractId: 'contract-1',
    planName: { durationDays: 30, price: MONTHLY },
    isRecurring: true,
    alreadyScheduledForCancellation: false,
    recurringCancelledAt: null,
    currentPeriodEndsAt: endsAt,
    nextBillingDate: endsAt,
    recommendedMode: 'AT_PERIOD_END',
    withdrawalDaysRemaining: 0,
    withdrawalWindowDays: 7,
    refundProcessingBusinessDays: 3,
    // 철회 가능 여부는 서버가 판단해 내려준다(1회 결제는 되살릴 자동결제가 없어 false).
    canUndoCancellation: false,
    // 실제 서버는 항상 두 선택지를 내려주고, 즉시해지가 불가하면 available=false + 사유를 담는다.
    options: [
      atPeriodEnd,
      {
        mode: 'IMMEDIATE_REFUND',
        available: false,
        unavailableReason: '결제 후 7일이 지나 환불이 불가합니다.',
        refundAmount: 0,
        refundKind: 'NONE',
        refundExecution: 'NONE',
        requiresReceiveAccount: false,
        effectiveEndsAt: iso(TODAY),
      },
    ],
  };

  switch (SCENARIO) {
    case 'recurring-withdrawal':
      return {
        subscription: base,
        preview: {
          ...previewBase,
          recommendedMode: 'IMMEDIATE_REFUND',
          withdrawalDaysRemaining: 5,
          options: [
            atPeriodEnd,
            {
              mode: 'IMMEDIATE_REFUND',
              available: true,
              refundAmount: MONTHLY,
              refundKind: 'WITHDRAWAL_FULL',
              refundExecution: 'AUTO',
              requiresReceiveAccount: false,
              effectiveEndsAt: iso(TODAY),
            },
          ],
        },
      };

    case 'recurring-no-refund':
      return {
        subscription: base,
        preview: {
          ...previewBase,
          options: [
            atPeriodEnd,
            {
              mode: 'IMMEDIATE_REFUND',
              available: false,
              unavailableReason: '이번 결제 주기에 멤버십 혜택을 사용해 환불이 불가합니다.',
              refundAmount: 0,
              refundKind: 'NONE',
              refundExecution: 'NONE',
              requiresReceiveAccount: false,
              effectiveEndsAt: iso(TODAY),
            },
          ],
        },
      };

    case 'annual-proration': {
      const annualEnd = plus(290);
      return {
        subscription: {
          ...base,
          planId: 'plan-annual',
          autoRenewal: false,
          nextBillingDate: null,
          endDate: annualEnd,
          currentPeriodEnd: annualEnd,
          billingDate: plus(-75),
          plan: plan(ANNUAL, 365),
        },
        preview: {
          ...previewBase,
          planName: { durationDays: 365, price: ANNUAL },
          isRecurring: false,
          nextBillingDate: null,
          currentPeriodEndsAt: annualEnd,
          recommendedMode: 'IMMEDIATE_REFUND',
          options: [
            { ...atPeriodEnd, effectiveEndsAt: annualEnd },
            {
              mode: 'IMMEDIATE_REFUND',
              available: true,
              refundAmount: 34930,
              refundKind: 'ANNUAL_PRORATION',
              refundExecution: 'AUTO',
              requiresReceiveAccount: false,
              effectiveEndsAt: iso(TODAY),
              breakdown: {
                paidAmount: ANNUAL,
                monthlyListPrice: MONTHLY,
                monthsElapsed: 3,
                usageDeduction: 14970,
                benefitDeduction: 0,
              },
            },
          ],
        },
      };
    }

    case 'scheduled': {
      const cancelledAt = new Date(TODAY.getTime() - 86400000).toISOString();
      return {
        subscription: { ...base, autoRenewal: false, nextBillingDate: null, recurringCancelledAt: cancelledAt },
        preview: {
          ...previewBase,
          alreadyScheduledForCancellation: true,
          recurringCancelledAt: cancelledAt,
          nextBillingDate: null,
          canUndoCancellation: true,
        },
      };
    }

    // 해지 예약을 먼저 고른 고객이 청약철회 7일 안에 마음을 바꾼 상태. 예약 뒤에도 즉시해지 + 전액
    // 환불은 서버가 받아준다(막히는 건 재예약뿐) — 화면에 진입점이 없으면 그 돈을 되돌릴 방법이 없다.
    case 'scheduled-refundable': {
      const cancelledAt = new Date(TODAY.getTime() - 86400000).toISOString();
      return {
        subscription: { ...base, autoRenewal: false, nextBillingDate: null, recurringCancelledAt: cancelledAt },
        preview: {
          ...previewBase,
          alreadyScheduledForCancellation: true,
          recurringCancelledAt: cancelledAt,
          nextBillingDate: null,
          canUndoCancellation: true,
          withdrawalDaysRemaining: 5,
          options: [
            atPeriodEnd,
            {
              mode: 'IMMEDIATE_REFUND',
              available: true,
              refundAmount: MONTHLY,
              refundKind: 'WITHDRAWAL_FULL',
              refundExecution: 'AUTO',
              requiresReceiveAccount: false,
              effectiveEndsAt: iso(TODAY),
            },
          ],
        },
      };
    }

    case 'one-time':
      return {
        subscription: { ...base, autoRenewal: false, nextBillingDate: null },
        preview: { ...previewBase, isRecurring: false, nextBillingDate: null },
      };

    // 1회 결제 고객의 해지 예약. 철회는 자동이체 약정을 새로 만들어 동의 없는 정기결제가 되므로
    // 버튼이 없어야 하고, **왜 없는지**가 화면에 있어야 한다(없으면 고객은 방법을 못 찾는다).
    case 'one-time-scheduled': {
      const cancelledAt = new Date(TODAY.getTime() - 86400000).toISOString();
      return {
        subscription: { ...base, autoRenewal: false, nextBillingDate: null, recurringCancelledAt: cancelledAt },
        preview: {
          ...previewBase,
          isRecurring: false,
          alreadyScheduledForCancellation: true,
          recurringCancelledAt: cancelledAt,
          nextBillingDate: null,
          canUndoCancellation: false,
        },
      };
    }

    case 'cms-manual':
      return {
        subscription: base,
        preview: {
          ...previewBase,
          recommendedMode: 'IMMEDIATE_REFUND',
          withdrawalDaysRemaining: 6,
          options: [
            atPeriodEnd,
            {
              mode: 'IMMEDIATE_REFUND',
              available: true,
              refundAmount: MONTHLY,
              refundKind: 'WITHDRAWAL_FULL',
              refundExecution: 'MANUAL',
              requiresReceiveAccount: true,
              effectiveEndsAt: iso(TODAY),
            },
          ],
        },
      };

    // 효성 CMS 선지급 — 자격은 받았지만 아직 출금 전. 청구 없이 즉시 종료되고 환불액은 0원이다.
    // '0원 환불' 로 안내하면 손해 보는 선택처럼 읽히므로 문구가 달라야 한다.
    case 'pre-collection':
      return {
        subscription: base,
        preview: {
          ...previewBase,
          // 수금 전 해지는 이번 요금 청구가 사라지므로 서버가 즉시해지를 권장한다.
          recommendedMode: 'IMMEDIATE_REFUND',
          withdrawalDaysRemaining: 5,
          options: [
            atPeriodEnd,
            {
              mode: 'IMMEDIATE_REFUND',
              available: true,
              refundAmount: 0,
              refundKind: 'PRE_COLLECTION_WITHDRAWAL',
              refundExecution: 'NONE',
              requiresReceiveAccount: false,
              effectiveEndsAt: iso(TODAY),
            },
          ],
        },
      };

    // 선지급 상태에서 이미 혜택을 쓴 경우 — 즉시 종료가 막히고 그 이유가 안내돼야 한다.
    case 'pre-collection-benefit-used':
      return {
        subscription: base,
        preview: {
          ...previewBase,
          options: [
            atPeriodEnd,
            {
              mode: 'IMMEDIATE_REFUND',
              available: false,
              refundAmount: 0,
              refundKind: 'NONE',
              refundExecution: 'NONE',
              requiresReceiveAccount: false,
              effectiveEndsAt: iso(TODAY),
              unavailableReason:
                '이미 멤버십 혜택을 사용하셔서 이번 기간 요금은 예정대로 출금됩니다. ' +
                '해지 예약을 하시면 이번 기간까지 이용하신 뒤 종료되고, 다음 기간부터는 청구되지 않습니다.',
            },
          ],
        },
      };

    // 즉시해지가 끝난 뒤 — 화면은 비가입자로 바뀌지만 환불이 어디까지 왔는지는 보여야 한다.
    case 'refund-pending':
    case 'refund-completed':
      return { subscription: null, preview: null };

    default:
      throw new Error(`unknown SCENARIO: ${SCENARIO}`);
  }
}

const { subscription, preview } = build();

/** 호출 기록 — 테스트가 "무엇이 어떤 payload 로 전송됐는지" 확인한다. */
const calls = [];

const CANCELLATION_REASONS = [
  { code: 'NOT_USING', displayText: '이용하지 않아요', category: 'GENERAL', sortOrder: 1 },
  { code: 'EXPENSIVE', displayText: '가격이 비싸요', category: 'PRICE', sortOrder: 2 },
  { code: 'OTHER', displayText: '기타', category: 'GENERAL', sortOrder: 99 },
];

function routes(pathname, method, body) {
  // user-service
  if (pathname === '/users/me') return { id: USER_ID, email: 'e2e@example.com', username: 'E2E', loginId: 'e2e' };
  if (pathname.startsWith('/cafe24')) return null; // 연동 없음

  // membership
  if (pathname === '/subscriptions/current') return subscription;
  if (pathname === '/subscriptions/cancel-preview') return preview;
  if (pathname === '/subscriptions/refund-status') {
    if (SCENARIO === 'refund-pending')
      return {
        contractId: 'contract-1',
        amount: MONTHLY,
        status: 'PENDING',
        requestedAt: new Date().toISOString(),
        completedAt: null,
        refundProcessingBusinessDays: 3,
        maskedAccount: { bank: '국민은행', accountNumber: '****6789', holderName: '홍길동' },
      };
    if (SCENARIO === 'refund-completed')
      return {
        contractId: 'contract-1',
        amount: MONTHLY,
        status: 'COMPLETED',
        requestedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
        completedAt: new Date(Date.now() - 86400000).toISOString(),
        refundProcessingBusinessDays: 3,
        maskedAccount: null,
      };
    return null;
  }
  // 스토어프론트는 { reasons: [...] } 형태를 기대한다(api() 가 { data } 를 벗긴 뒤 .reasons 를 읽는다).
  if (pathname === '/subscriptions/cancellation-reasons') return { reasons: CANCELLATION_REASONS };
  if (pathname === '/subscriptions/history') return [];
  if (pathname === '/plans') return subscription ? [{ plan: subscription.plan, tier: TIER }] : [];
  if (pathname === '/membership/savings/current-month') return { totalSavings: 12000, orderCount: 2 };
  if (pathname === '/membership/savings/range') return { months: [] };
  if (pathname === '/membership/benefits/current')
    return { userId: USER_ID, cycleStartDate: plus(-2), cycleEndDate: plus(28), totalDiscountAmount: 0, orderCount: 0 };
  if (pathname === '/membership/benefits/history') return { cycles: [], totalCycles: 0, totalDiscountAllTime: 0 };

  if (pathname === '/subscriptions/cancel' && method === 'POST') {
    calls.push({ path: pathname, body });
    return body?.cancelType === 'IMMEDIATE_REFUND'
      ? {
          type: 'IMMEDIATE_CANCELLATION',
          contractId: 'contract-1',
          status: 'CANCELLED',
          cancelledAt: new Date().toISOString(),
          refundEligible: true,
          refundAmount: preview.options.find((o) => o.mode === 'IMMEDIATE_REFUND')?.refundAmount ?? 0,
          // 효성 CMS 는 PG 환불 API 가 없어 돈이 아직 나가지 않은 상태로 끝난다(관리자 계좌 송금 대기).
          refundStatus: SCENARIO === 'cms-manual' ? 'PENDING' : SCENARIO === 'pre-collection' ? 'NOT_APPLICABLE' : 'COMPLETED',
          message: '해지되었습니다.',
        }
      : {
          type: 'RECURRING_CANCELLATION',
          contractId: 'contract-1',
          status: 'RECURRING_CANCELLED',
          recurringCancelledAt: new Date().toISOString(),
          nextBillingDate: null,
          currentPeriodEndsAt: preview.currentPeriodEndsAt,
          autoRenewal: false,
          refundEligible: false,
          message: '해지 예약되었습니다.',
        };
  }

  if (pathname === '/subscriptions/cancel/undo' && method === 'POST') {
    calls.push({ path: pathname, body });
    return {
      type: 'CANCELLATION_UNDONE',
      contractId: 'contract-1',
      status: 'ACTIVE',
      autoRenewal: true,
      nextBillingDate: preview.currentPeriodEndsAt,
      message: '해지 예약이 철회되었습니다.',
    };
  }

  // wallet
  if (pathname === '/v1/me/invoices') return [];
  if (pathname.startsWith('/v1/billing-methods')) return [];

  // 테스트 전용 — 호출 기록 확인/초기화 (테스트 간 누적을 끊는다)
  if (pathname === '/__calls') return calls;
  if (pathname === '/__reset') {
    calls.length = 0;
    return { ok: true };
  }

  // 미등록 경로만 undefined. null 은 '없음' 을 뜻하는 정상 응답이라 200 으로 내려야 한다
  // (환불 이력 없음, 활성 구독 없음 등).
  return undefined;
}

function start(port, label) {
  createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = undefined;
      }

      const data = routes(url.pathname, req.method, body);
      res.setHeader('content-type', 'application/json');
      res.setHeader('access-control-allow-origin', '*');

      if (data === undefined) {
        res.statusCode = 404;
        res.end(JSON.stringify({ message: 'not found' }));
        return;
      }
      res.statusCode = 200;
      // 스토어프론트 api() 는 { data } 래핑을 벗겨낸다.
      res.end(JSON.stringify({ success: true, data }));
    });
  }).listen(port, () => console.log(`[stub:${label}] :${port} scenario=${SCENARIO}`));
}

start(3000, 'users');
start(3001, 'membership');
start(5001, 'wallet');
