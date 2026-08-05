/**
 * 관리자 해지·환불 UI E2E 용 스텁 백엔드 (membership + user-service).
 *
 * admin-web 은 브라우저 → /api/proxy/{membership,users} → 서버 env 의 서비스 URL 로 전달한다.
 * 그래서 MEMBERSHIP_SERVICE_URL / USER_SERVICE_URL 을 이 스텁으로 돌려두면 백엔드 없이 실제 화면을 검증할 수 있다.
 *
 * SCENARIO:
 *   annual        연간 계약 — 정책 정산 견적(34,930원), 전액 환불 시 경고
 *   monthly-cms   월간 자동이체 — 자동환불 불가 → 계좌 입력 필요
 *   scheduled     해지 예약됨 — 배너 + 철회 + 수동 송금 계좌 노출
 *   one-time      1회 결제 — 예약 해지 불필요 안내
 *   one-time-scheduled  1회 결제인데 해지 예약됨 — 철회(=무단 정기결제 전환) 버튼이 없어야 한다
 *   no-payment    결제 내역이 없는 계약(관리자 지급)에 환불 요청이 걸린 잔재 — 보낼 곳이 없음을 알려야 한다
 *   no-payment-active  결제 없는 활성 계약 — 강제취소 다이얼로그가 환불 유형을 열면 안 된다
 *   legacy-detail 배포 과도기(옛 membership 응답) — 새 필드가 없어도 송금 완료 창구가 살아있어야 한다
 *   pg-settled    자동환불이 FAILED 로 기록됐지만 결제관리에는 실제로 환불이 나간 건 —
 *                 관리자가 계좌로 또 보내지 않도록 화면이 먼저 알려야 한다
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
    canUndoCancellation: false,
    hasPaymentIntent: true,
    manualRefundAccount: null,
    refundSettlement: null,
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
        canUndoCancellation: true,
        // 효성 CMS 수동 송금 대기 — 관리자가 이 계좌로 보내야 환불이 끝난다.
        manualRefundAccount: { bank: '20', accountNumber: '110123456789', holderName: '테스트고객' },
      };
    case 'one-time':
      return { ...base, autoRenewal: false, nextBillingDate: null };
    // 관리자 무료 지급 계약(결제 없음)에 '전액 환불' 강제취소가 걸린 라이브 잔재 형태.
    case 'no-payment':
      return {
        ...base,
        status: 'CANCELLED',
        autoRenewal: false,
        nextBillingDate: null,
        cancelledAt: new Date(Date.now() - 86400000).toISOString(),
        refundRequested: true,
        eligibleRefundAmount: MONTHLY,
        refundCompleted: false,
        hasPaymentIntent: false,
        manualRefundAccount: null,
        refundSettlement: null,
      };
    // 결제 없는 계약이 아직 살아있는 상태. 강제취소 다이얼로그가 환불 유형을 열어주면 안 된다.
    case 'no-payment-active':
      return { ...base, autoRenewal: false, nextBillingDate: null, hasPaymentIntent: false };
    // 배포 과도기 — admin-web 이 membership 보다 먼저 뜬 창. 새 필드(hasPaymentIntent/refundSettlement)가
    // 아예 없는 옛 응답이다. 이때 화면이 "환불 대상 결제 없음" 으로 뒤집히면 정상 수동 송금 건의
    // 완료 처리 창구가 사라진다.
    case 'legacy-detail': {
      const legacy = {
        ...base,
        status: 'CANCELLED',
        autoRenewal: false,
        nextBillingDate: null,
        cancelledAt: new Date(Date.now() - 86400000).toISOString(),
        refundRequested: true,
        eligibleRefundAmount: MONTHLY,
        refundCompleted: false,
        manualRefundAccount: { bank: '20', accountNumber: '110123456789', holderName: '테스트고객' },
      };
      delete legacy.hasPaymentIntent;
      delete legacy.refundSettlement;
      return legacy;
    }
    // 결제관리에서 직접 환불한 건 — 멤버십은 환불을 요청한 적이 없어 '환불 없음' 으로 보였다.
    case 'external-refund':
      return {
        ...base,
        status: 'CANCELLED',
        autoRenewal: false,
        nextBillingDate: null,
        cancelledAt: new Date(Date.now() - 86400000).toISOString(),
        refundRequested: false,
        refundCompleted: false,
        eligibleRefundAmount: null,
        refundSettlement: { alreadyRefundedAmount: MONTHLY, pendingRefundAmount: 0 },
      };
    // 무통장 자동환불이 끝난 건 — 어느 계좌로 나갔는지 남아야 문의에 답할 수 있다.
    case 'refunded-account':
      return {
        ...base,
        status: 'CANCELLED',
        autoRenewal: false,
        nextBillingDate: null,
        cancelledAt: new Date(Date.now() - 86400000).toISOString(),
        refundRequested: true,
        refundCompleted: true,
        refundCompletedAt: new Date(Date.now() - 86400000).toISOString(),
        eligibleRefundAmount: MONTHLY,
        refundReceiveAccount: { bank: '20', accountNumber: '110123456789', holderName: '테스트고객' },
      };
    // 자동환불이 실패로 기록됐지만 실제로는 PG 로 나간 건. 계좌 송금이 아니라 기록 정리만 남았다.
    case 'pg-settled':
      return {
        ...base,
        status: 'ACTIVE',
        autoRenewal: false,
        nextBillingDate: null,
        refundRequested: true,
        eligibleRefundAmount: MONTHLY,
        refundCompleted: false,
        manualRefundAccount: { bank: '20', accountNumber: '110123456789', holderName: '테스트고객' },
        refundSettlement: { alreadyRefundedAmount: MONTHLY, pendingRefundAmount: 0 },
      };
    // 무통장 환불이 결제관리에서 확정 대기 중 — 여기서 완료로 찍으면 이중 송금이 된다.
    case 'pg-pending':
      return {
        ...base,
        autoRenewal: false,
        nextBillingDate: null,
        refundRequested: true,
        eligibleRefundAmount: MONTHLY,
        refundCompleted: false,
        manualRefundAccount: { bank: '20', accountNumber: '110123456789', holderName: '테스트고객' },
        refundSettlement: { alreadyRefundedAmount: 0, pendingRefundAmount: MONTHLY },
      };
    // 1회 결제 고객이 해지 예약한 상태. 철회는 wallet 자동이체 약정을 새로 만들어 동의 없는
    // 정기결제로 전환시키므로 서버가 canUndoCancellation=false 로 내려주고 버튼이 없어야 한다.
    case 'one-time-scheduled':
      return {
        ...base,
        autoRenewal: false,
        nextBillingDate: null,
        recurringCancelledAt: new Date(Date.now() - 86400000).toISOString(),
        recurringCancellationReasonCode: 'NOT_USING',
        canUndoCancellation: false,
      };
    default:
      return base;
  }
}

function quote() {
  const isAnnual = SCENARIO === 'annual';
  const manual = SCENARIO === 'monthly-cms';
  const scheduled = SCENARIO === 'scheduled' || SCENARIO === 'one-time-scheduled';
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
    isRecurring: !SCENARIO.startsWith('one-time') && !isAnnual,
    alreadyScheduledForCancellation: scheduled,
    recurringCancelledAt: scheduled ? new Date(Date.now() - 86400000).toISOString() : null,
    currentPeriodEndsAt: endsAt,
    nextBillingDate: scheduled ? null : endsAt,
    recommendedMode: 'AT_PERIOD_END',
    withdrawalDaysRemaining: manual ? 6 : 0,
    withdrawalWindowDays: 7,
    refundProcessingBusinessDays: 3,
    // 결제 내역이 없는 계약은 서버가 환불 유형을 400 으로 거부한다 — 견적이 먼저 알려준다.
    hasPaymentIntent: !SCENARIO.startsWith('no-payment'),
    options: [atPeriodEnd, immediate],
  };
}

const MEMBER = detail();

function routes(pathname, method, body, params) {
  // user-service (useUserNames → 고객 email 을 화면과 강제취소 요청에 쓴다)
  if (pathname.startsWith('/admin/users/') && pathname !== `/admin/users/${USER_ID}` && !pathname.endsWith('/pause-history'))
    return {
      id: pathname.split('/').pop(),
      loginId: pathname.split('/').pop(),
      username: '테스트고객2',
      nickname: null,
      email: 'customer2@example.com',
      isEmailVerified: true,
      lastActivityAt: null,
      createdAt: '',
      updatedAt: '',
      deletedAt: null,
      roles: ['user'],
    };

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

  // 해지 내역 목록: 즉시해지와 예약해지가 한 화면에 있어야 하고, 환불 상태가 행에서 바로 보여야 한다.
  if (pathname === '/admin/members' && SCENARIO === 'cancellation-list') {
    const rows = [
      {
        userId: USER_ID,
        contractId: CONTRACT_ID,
        status: 'CANCELLED',
        tierCode: 'MEMBERSHIP',
        planDurationDays: 30,
        startsAt: plus(-20),
        endsAt: plus(-1),
        createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
        cancelledAt: new Date(Date.now() - 86400000).toISOString(),
        recurringCancelledAt: null,
        cancellationReasonCode: 'NOT_USING',
        cancellationReasonText: '이용하지 않아요',
        recurringCancellationReasonCode: null,
        autoRenewal: false,
        firstContractCreatedAt: new Date(Date.now() - 20 * 86400000).toISOString(),
        refundRequested: true,
        refundCompleted: false,
        refundCompletedAt: null,
        eligibleRefundAmount: MONTHLY,
        hasPaymentIntent: true,
        billingPath: 'INVOICE',
      },
      {
        userId: 'e2e-user-2',
        contractId: '22222222-2222-4222-8222-222222222222',
        status: 'ACTIVE',
        tierCode: 'MEMBERSHIP',
        planDurationDays: 30,
        startsAt: plus(-5),
        endsAt: plus(25),
        createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        cancelledAt: null,
        recurringCancelledAt: new Date(Date.now() - 3600000).toISOString(),
        cancellationReasonCode: null,
        cancellationReasonText: '가격이 부담돼요',
        recurringCancellationReasonCode: 'EXPENSIVE',
        autoRenewal: false,
        firstContractCreatedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        refundRequested: false,
        refundCompleted: false,
        refundCompletedAt: null,
        eligibleRefundAmount: null,
        hasPaymentIntent: true,
        billingPath: 'CHARGE',
      },
      {
        userId: 'e2e-user-3',
        contractId: '33333333-3333-4333-8333-333333333333',
        status: 'CANCELLED',
        tierCode: 'MEMBERSHIP',
        planDurationDays: 365,
        startsAt: plus(-100),
        endsAt: plus(-2),
        createdAt: new Date(Date.now() - 100 * 86400000).toISOString(),
        cancelledAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        recurringCancelledAt: null,
        cancellationReasonCode: 'ADMIN_FORCED',
        cancellationReasonText: null,
        recurringCancellationReasonCode: null,
        autoRenewal: false,
        firstContractCreatedAt: new Date(Date.now() - 100 * 86400000).toISOString(),
        refundRequested: true,
        refundCompleted: true,
        refundCompletedAt: new Date(Date.now() - 86400000).toISOString(),
        eligibleRefundAmount: 34930,
        hasPaymentIntent: true,
        billingPath: 'CHARGE',
      },
    ];

    rows.push({
      userId: 'e2e-user-5',
      contractId: '55555555-5555-4555-8555-555555555555',
      status: 'CANCELLED',
      tierCode: 'MEMBERSHIP',
      planDurationDays: 30,
      startsAt: plus(-4),
      endsAt: plus(26),
      createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
      cancelledAt: new Date().toISOString(),
      recurringCancelledAt: null,
      // 시스템이 계좌 심사 거절로 끊은 건 — 고객이 해지한 것이 아니다.
      cancellationReasonCode: 'MANDATE_REJECTED',
      cancellationReasonText: null,
      recurringCancellationReasonCode: null,
      autoRenewal: false,
      firstContractCreatedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
      refundRequested: false,
      refundCompleted: false,
      refundCompletedAt: null,
      eligibleRefundAmount: null,
      hasPaymentIntent: false,
      billingPath: 'INVOICE',
    });

    rows.push({
      userId: 'e2e-user-4',
      contractId: '44444444-4444-4444-8444-444444444444',
      status: 'EXPIRED',
      tierCode: 'MEMBERSHIP',
      planDurationDays: 30,
      startsAt: plus(-60),
      endsAt: plus(-30),
      createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
      cancelledAt: null,
      // 해지 예약 후 이용 종료일이 지나 실제로 끝난 건.
      recurringCancelledAt: new Date(Date.now() - 45 * 86400000).toISOString(),
      cancellationReasonCode: null,
      cancellationReasonText: '이용하지 않아요',
      recurringCancellationReasonCode: 'NOT_USING',
      autoRenewal: false,
      firstContractCreatedAt: new Date(Date.now() - 60 * 86400000).toISOString(),
      refundRequested: false,
      refundCompleted: false,
      refundCompletedAt: null,
      eligibleRefundAmount: null,
      hasPaymentIntent: true,
      billingPath: 'CHARGE',
    });

    // 서버가 계산해 내려주는 종료 사실. 화면은 이 값을 그대로 쓴다(추론하지 않는다).
    const withCancellation = (r) => {
      const info =
        r.status === 'CANCELLED' && r.cancellationReasonCode === 'MANDATE_REJECTED'
          ? {
              origin: 'MANDATE_REJECTED',
              originLabel: '계좌 심사 거절로 종료',
              reasonLabel: '계좌 자동이체 심사 거절',
              reasonDetail: 'Q201',
              customerNotice: '등록하신 계좌의 자동이체 심사가 거절되어 멤버십이 종료되었습니다.',
            }
          : r.status === 'CANCELLED'
            ? {
                origin: 'CUSTOMER_IMMEDIATE',
                originLabel: '고객 즉시해지',
                reasonLabel: r.cancellationReasonText ?? null,
                reasonDetail: null,
                customerNotice: null,
              }
            : {
                origin: 'CUSTOMER_SCHEDULED',
                originLabel: '고객 해지예약',
                reasonLabel: r.cancellationReasonText ?? null,
                reasonDetail: null,
                customerNotice: null,
              };
      const ended = r.status !== 'ACTIVE';
      return {
        ...r,
        cancellation: {
          ...info,
          state: ended ? 'ENDED' : 'SCHEDULED_ACTIVE',
          stateLabel: ended ? '이용 종료' : '이용 중',
          requestedAt: r.cancelledAt ?? r.recurringCancelledAt ?? null,
          endedAt: r.cancelledAt ?? null,
          endsAt: r.endsAt ?? null,
        },
      };
    };

    // 서버가 실제로 하는 필터를 그대로 흉내낸다 — 화면이 파라미터를 제대로 보내는지 검증하기 위함.
    const status = params?.get('status') ?? 'CANCELLED_ANY';
    const refundPending = params?.get('refundPending') === 'true';
    const filtered = rows
      .filter((r) =>
        status === 'CANCELLED'
          ? r.status === 'CANCELLED'
          : status === 'RECURRING_CANCELLED'
            ? r.status === 'ACTIVE' && !!r.recurringCancelledAt
            : status === 'RECURRING_CANCELLED_ENDED'
              ? r.status === 'EXPIRED' && !!r.recurringCancelledAt
              : true,
      )
      .filter((r) => (refundPending ? r.refundRequested && !r.refundCompleted : true));

    return { data: filtered.map(withCancellation), total: filtered.length, page: 1, limit: 20 };
  }

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

    const data = routes(url.pathname, req.method, body, url.searchParams);
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
