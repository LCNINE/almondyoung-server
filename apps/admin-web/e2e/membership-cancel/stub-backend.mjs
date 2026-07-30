/**
 * 관리자 해지·환불 UI E2E 용 스텁 백엔드 (membership + user-service).
 *
 * admin-web 은 브라우저 → /api/proxy/{membership,users} → 서버 env 의 서비스 URL 로 전달한다.
 * 그래서 MEMBERSHIP_SERVICE_URL / USER_SERVICE_URL 을 이 스텁으로 돌려두면 백엔드 없이 실제 화면을 검증할 수 있다.
 *
 * SCENARIO:
 *   annual        연간 계약 — 정책 정산 견적(34,930원), 전액 환불 시 경고
 *   monthly-cms   월간 자동이체 — 자동환불 불가 → 계좌 입력 필요
 *   scheduled     해지 예약됨 — 배너 + 철회
 *   one-time      1회 결제 — 예약 해지 불필요 안내
 */
import { createServer } from 'node:http';

const SCENARIO = process.env.SCENARIO ?? 'annual';
const PORT = Number(process.env.STUB_PORT ?? 4801);
const USER_ID = 'e2e-user';
const CONTRACT_ID = '11111111-1111-4111-8111-111111111111';
const MONTHLY = 4990;
const ANNUAL = 49900;

const iso = (d) => d.toISOString().slice(0, 10);
const plus = (days) => iso(new Date(Date.now() + days * 86400000));

const calls = [];

function detail() {
  const base = {
    contractId: CONTRACT_ID,
    userId: USER_ID,
    status: 'ACTIVE',
    tierCode: 'MEMBERSHIP',
    tierPriority: 1,
    planId: 'plan-1',
    planDurationDays: 30,
    billingDate: plus(-5),
    nextBillingDate: plus(25),
    startsAt: plus(-5),
    endsAt: plus(25),
    isPaused: false,
    pausedAt: null,
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    cancelledAt: null,
    autoRenewal: true,
    recurringCancelledAt: null,
    recurringCancellationReasonCode: null,
    refundRequested: false,
    refundRequestedAt: null,
    eligibleRefundAmount: null,
    refundCompleted: false,
    refundCompletedAt: null,
    pauseCount: 0,
    firstContractCreatedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  };

  switch (SCENARIO) {
    case 'annual':
      return { ...base, planDurationDays: 365, autoRenewal: false, nextBillingDate: null, endsAt: plus(290) };
    case 'scheduled':
      return {
        ...base,
        autoRenewal: false,
        nextBillingDate: null,
        recurringCancelledAt: new Date(Date.now() - 86400000).toISOString(),
        recurringCancellationReasonCode: 'NOT_USING',
        refundRequested: true,
        eligibleRefundAmount: MONTHLY,
        refundCompleted: false,
      };
    case 'one-time':
      return { ...base, autoRenewal: false, nextBillingDate: null };
    default:
      return base;
  }
}

function quote() {
  const isAnnual = SCENARIO === 'annual';
  const manual = SCENARIO === 'monthly-cms';
  const endsAt = isAnnual ? plus(290) : plus(25);

  const atPeriodEnd = {
    mode: 'AT_PERIOD_END',
    available: true,
    refundAmount: 0,
    refundKind: 'NONE',
    refundExecution: 'NONE',
    requiresReceiveAccount: false,
    effectiveEndsAt: endsAt,
  };

  const immediate = isAnnual
    ? {
        mode: 'IMMEDIATE_REFUND',
        available: true,
        refundAmount: 34930,
        refundKind: 'ANNUAL_PRORATION',
        refundExecution: 'AUTO',
        requiresReceiveAccount: false,
        effectiveEndsAt: iso(new Date()),
        breakdown: {
          paidAmount: ANNUAL,
          monthlyListPrice: MONTHLY,
          monthsElapsed: 3,
          usageDeduction: 14970,
          benefitDeduction: 0,
        },
      }
    : {
        mode: 'IMMEDIATE_REFUND',
        available: true,
        refundAmount: MONTHLY,
        refundKind: 'WITHDRAWAL_FULL',
        refundExecution: manual ? 'MANUAL' : 'AUTO',
        requiresReceiveAccount: manual,
        effectiveEndsAt: iso(new Date()),
      };

  return {
    contractId: CONTRACT_ID,
    planName: { durationDays: isAnnual ? 365 : 30, price: isAnnual ? ANNUAL : MONTHLY },
    isRecurring: SCENARIO !== 'one-time' && !isAnnual,
    alreadyScheduledForCancellation: SCENARIO === 'scheduled',
    recurringCancelledAt: SCENARIO === 'scheduled' ? new Date(Date.now() - 86400000).toISOString() : null,
    currentPeriodEndsAt: endsAt,
    nextBillingDate: SCENARIO === 'scheduled' ? null : endsAt,
    recommendedMode: 'AT_PERIOD_END',
    withdrawalDaysRemaining: manual ? 6 : 0,
    withdrawalWindowDays: 7,
    refundProcessingBusinessDays: 3,
    options: [atPeriodEnd, immediate],
  };
}

const MEMBER = detail();

function routes(pathname, method, body) {
  // user-service (useUserNames → 고객 email 을 화면과 강제취소 요청에 쓴다)
  if (pathname === `/admin/users/${USER_ID}`)
    return {
      id: USER_ID,
      loginId: 'e2euser',
      username: '테스트고객',
      nickname: null,
      email: 'customer@example.com',
      isEmailVerified: true,
      lastActivityAt: null,
      createdAt: '',
      updatedAt: '',
      deletedAt: null,
      roles: ['user'],
    };

  // membership admin
  if (pathname === '/admin/members')
    return {
      data: [
        {
          userId: USER_ID,
          contractId: CONTRACT_ID,
          status: MEMBER.status,
          tierCode: 'MEMBERSHIP',
          planDurationDays: MEMBER.planDurationDays,
          startsAt: MEMBER.startsAt,
          endsAt: MEMBER.endsAt,
          createdAt: MEMBER.createdAt,
          cancelledAt: null,
          cancellationReasonCode: null,
          autoRenewal: MEMBER.autoRenewal,
          firstContractCreatedAt: MEMBER.firstContractCreatedAt,
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    };

  if (pathname === `/admin/members/${USER_ID}`) return MEMBER;
  if (pathname === `/admin/subscriptions/${CONTRACT_ID}/cancellation-quote`) return quote();
  if (pathname === '/admin/billing-events' || pathname.startsWith('/admin/billing-events')) return [];
  if (pathname.startsWith('/admin/contract-events')) return [];
  if (pathname.startsWith('/admin/users/') && pathname.endsWith('/pause-history')) return [];

  if (pathname === `/admin/subscriptions/${CONTRACT_ID}/force-cancel` && method === 'POST') {
    calls.push({ path: 'force-cancel', body });
    const amount = body?.refundType === 'NONE' ? 0 : (body?.refundAmount ?? quote().planName.price);
    return {
      contractId: CONTRACT_ID,
      status: 'CANCELLED',
      cancelledAt: new Date().toISOString(),
      refundEligible: amount > 0,
      refundAmount: amount,
      refundStatus: amount > 0 ? 'COMPLETED' : 'NOT_APPLICABLE',
    };
  }

  if (pathname === `/admin/subscriptions/${CONTRACT_ID}/schedule-cancel` && method === 'POST') {
    calls.push({ path: 'schedule-cancel', body });
    return {
      type: 'RECURRING_CANCELLATION',
      contractId: CONTRACT_ID,
      status: 'RECURRING_CANCELLED',
      recurringCancelledAt: new Date().toISOString(),
      nextBillingDate: null,
      currentPeriodEndsAt: MEMBER.endsAt,
      autoRenewal: false,
      refundEligible: false,
      message: '정기결제가 중단되었습니다.',
    };
  }

  if (pathname === `/admin/contracts/${CONTRACT_ID}/auto-renewal` && method === 'PUT') {
    calls.push({ path: 'auto-renewal', body });
    return { contractId: CONTRACT_ID, autoRenewal: body?.autoRenewal };
  }

  if (pathname === '/__calls') return calls;
  if (pathname === '/__reset') {
    calls.length = 0;
    return { ok: true };
  }

  return null;
}

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
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
    if (data === null) {
      res.statusCode = 404;
      res.end(JSON.stringify({ success: false, message: 'not found' }));
      return;
    }
    res.statusCode = 200;
    // admin-web axios 인터셉터가 { success, data } 를 벗긴다.
    res.end(JSON.stringify({ success: true, data }));
  });
}).listen(PORT, () => console.log(`[admin-stub] :${PORT} scenario=${SCENARIO}`));
