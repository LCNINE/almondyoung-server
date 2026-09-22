import { sql } from 'drizzle-orm';
import { SeedStep } from './base-seed-step';
import { SeedCheckResult, SeedApplyResult } from '../lib/types';
import { FIXED_UUIDS } from '../constants/uuids';

export interface NotificationConfig {
  fcmPrivateKey: string;
  resendApiKey: string;
  nhnSmsAppKey: string;
  nhnSmsSecretKey: string;
  nhnSmsSendNo: string;
  nhnAppKey: string;
  nhnSecretKey: string;
  nhnSenderKey: string;
}

function buildProviders(config: NotificationConfig) {
  return [
    {
      providerId: FIXED_UUIDS.PROVIDER_FCM_PUSH,
      providerName: 'FCM Push',
      channel: 'PUSH',
      config: {
        timeout: 30000,
        clientId: '107487182970332379639',
        projectId: 'notification-service-a5dff',
        privateKey: config.fcmPrivateKey,
        clientEmail: 'firebase-adminsdk-fbsvc@notification-service-a5dff.iam.gserviceaccount.com',
        privateKeyId: '33b8b49babb281a4d4b89e19486ab856d2095649',
      },
      status: 'ACTIVE',
      priority: 10,
    },
    {
      providerId: FIXED_UUIDS.PROVIDER_RESEND_EMAIL,
      providerName: 'Resend Email',
      channel: 'EMAIL',
      config: {
        apiKey: config.resendApiKey,
        baseUrl: 'https://api.resend.com',
        timeout: 30000,
        fromName: 'Almond Young',
        fromEmail: 'noreply@almondyoung.com',
        maxRetries: 3,
        retryDelay: 1000,
      },
      status: 'ACTIVE',
      priority: 10,
    },
    {
      providerId: FIXED_UUIDS.PROVIDER_NHN_SMS,
      providerName: 'NHN SMS',
      channel: 'SMS',
      config: {
        apiUrl: 'https://sms.api.nhncloudservice.com',
        appKey: config.nhnSmsAppKey,
        secretKey: config.nhnSmsSecretKey,
        sendNo: config.nhnSmsSendNo,
        timeout: 30000,
      },
      status: 'ACTIVE',
      priority: 10,
    },
    {
      providerId: FIXED_UUIDS.PROVIDER_NHN_KAKAO,
      providerName: 'NHN KakaoTalk',
      channel: 'KAKAO',
      config: {
        apiUrl: 'https://api-alimtalk.cloud.toast.com',
        appKey: config.nhnAppKey,
        timeout: 30000,
        secretKey: config.nhnSecretKey,
        senderKey: config.nhnSenderKey,
        plusFriendId: '@아몬드영',
        resendAppKey: '',
      },
      status: 'ACTIVE',
      priority: 10,
    },
  ];
}

/**
 * 자동갱신 사전 고지 메일 (전자상거래법 계속거래 고지).
 *
 * 법정 고지라 TRANSACTIONAL 이다 — 마케팅 수신거부와 무관하게 나가야 한다.
 * 문구를 고칠 때는 결제 예정일·금액·해지 방법 세 가지가 빠지지 않게 한다.
 */
const RENEWAL_NOTICE_TEMPLATE = {
  templateId: FIXED_UUIDS.TEMPLATE_MEMBERSHIP_RENEWAL_UPCOMING,
  templateKey: 'MEMBERSHIP_RENEWAL_UPCOMING',
  name: '멤버십 자동갱신 사전 안내',
  category: 'TRANSACTIONAL',
  // 언어 레이어(`EMAIL.ko`)가 필수다 — 렌더러는 contents.ko.EMAIL 또는 contents.EMAIL.ko 만
  // 찾는다. 이 층이 빠져 있어 2026-08 내내 제목 없이 payload JSON 원문이 발송됐다(81건).
  //
  // 헬퍼 문법(`{{formatDate x}}`)도 쓰면 안 된다 — 렌더러 정규식이 `[\w.]+` 라 공백이 든
  // 표현은 매치되지 않고 리터럴로 남는다. 포맷은 컨슈머가 끝내서 넘긴다.
  contents: {
    EMAIL: {
      ko: {
        subject: '[아몬드영] {{nextBillingDate}} 멤버십이 자동 갱신됩니다',
        body: [
          '<p>{{userName}}님, 안녕하세요.</p>',
          '<p>이용 중인 <strong>{{planName}}</strong> 멤버십이 <strong>{{nextBillingDate}}</strong>에 자동 갱신될 예정입니다.',
          ' 결제 예정일 {{noticeDaysBefore}}일 전에 미리 안내드립니다.</p>',
          '<table>',
          '<tr><th>결제 예정일</th><td>{{nextBillingDate}}</td></tr>',
          '<tr><th>결제 예정 금액</th><td>{{amount}}원</td></tr>',
          '<tr><th>결제 수단</th><td>{{paymentMethodLabel}}</td></tr>',
          '<tr><th>갱신 후 이용 기간</th><td>{{nextBillingDate}} ~ {{nextPeriodEnd}}</td></tr>',
          '</table>',
          '<p>갱신을 원하지 않으시면 <strong>{{nextBillingDate}} 전까지</strong> 아래에서 해지해 주세요.',
          ' 해지하셔도 이미 결제하신 기간({{currentPeriodEnd}}까지)은 그대로 이용하실 수 있습니다.</p>',
          '<p><a href="{{manageUrl}}">멤버십 관리 · 해지하기</a></p>',
          '<p>문의: 고객센터 1877-7184</p>',
          '<p>본 메일은 전자상거래법에 따른 계속거래 갱신 사전 고지 안내로, 수신거부 대상이 아닙니다.</p>',
        ].join('\n'),
      },
    },
  },
  variablesSchema: {
    userName: { type: 'string', required: true },
    planName: { type: 'string', required: true },
    nextBillingDate: { type: 'string', required: true },
    // 컨슈머가 formatAmount 로 "29,900" 문자열을 넘기고 본문도 `{{amount}}원` 으로 단위를
    // 붙이므로 string 이다. number 로 두면 스키마 기반 변수 추출 경로에서 타입이 어긋난다.
    amount: { type: 'string', required: true },
    paymentMethodLabel: { type: 'string', required: true },
    currentPeriodEnd: { type: 'string', required: true },
    nextPeriodEnd: { type: 'string', required: true },
    noticeDaysBefore: { type: 'number', required: true },
    manageUrl: { type: 'string', required: true },
  },
};

const RENEWAL_NOTICE_EVENT = {
  eventKey: 'MEMBERSHIP_RENEWAL_UPCOMING',
  name: '멤버십 자동갱신 사전 안내',
  description: '결제 예정일 N일 전 자동갱신 사전 고지',
  templateKey: RENEWAL_NOTICE_TEMPLATE.templateKey,
  category: 'TRANSACTIONAL',
  defaultChannels: ['EMAIL'],
  priority: 'HIGH',
};

/**
 * 만료 사전 안내. 자동갱신이 예정돼 있지 않은 이용권(1회 결제·해지 예약·관리자 부여)이 대상이다.
 * 갱신 고지와 달리 결제가 예정돼 있지 않으므로 금액·결제수단을 넣지 않는다.
 */
const EXPIRY_NOTICE_TEMPLATE = {
  templateId: FIXED_UUIDS.TEMPLATE_MEMBERSHIP_EXPIRY_UPCOMING,
  templateKey: 'MEMBERSHIP_EXPIRY_UPCOMING',
  name: '멤버십 만료 사전 안내',
  category: 'TRANSACTIONAL',
  // 언어 레이어와 헬퍼 금지 이유는 위 RENEWAL_NOTICE_TEMPLATE 주석 참고.
  contents: {
    EMAIL: {
      ko: {
        subject: '[아몬드영] {{expiresAt}} 멤버십 이용이 종료됩니다',
        body: [
          '<p>{{userName}}님, 안녕하세요.</p>',
          '<p>이용 중인 <strong>{{planName}}</strong>의 이용 기간이 <strong>{{expiresAt}}</strong>에 종료됩니다.',
          ' 종료 {{noticeDaysBefore}}일 전에 미리 안내드립니다.</p>',
          '<table>',
          '<tr><th>이용 종료일</th><td>{{expiresAt}}</td></tr>',
          '</table>',
          '<p>종료일 이후에는 멤버십 전용가와 혜택이 적용되지 않습니다.',
          ' 계속 이용하시려면 아래에서 멤버십을 다시 신청해 주세요.</p>',
          '<p><a href="{{manageUrl}}">멤버십 관리하기</a></p>',
          '<p>문의: <a href="https://pf.kakao.com/_xaxgxazs">카카오톡 채널 아몬드영</a> · 고객센터 1877-7184</p>',
        ].join('\n'),
      },
    },
  },
  variablesSchema: {
    userName: { type: 'string', required: true },
    planName: { type: 'string', required: true },
    expiresAt: { type: 'string', required: true },
    noticeDaysBefore: { type: 'number', required: true },
    manageUrl: { type: 'string', required: true },
  },
};

const EXPIRY_NOTICE_EVENT = {
  eventKey: 'MEMBERSHIP_EXPIRY_UPCOMING',
  name: '멤버십 만료 사전 안내',
  description: '이용 종료일 N일 전 만료 사전 안내 (자동갱신 대상 제외)',
  templateKey: EXPIRY_NOTICE_TEMPLATE.templateKey,
  category: 'TRANSACTIONAL',
  defaultChannels: ['EMAIL'],
  priority: 'HIGH',
};

/**
 * CMS 자동이체 계좌 등록 심사 거절 안내.
 *
 * 효성이 보내는 문자("신청하신 자동이체가 등록되었습니다")는 접수 확인이지 심사 통과가 아니다.
 * 실제 심사는 D+1 에 나오고 생년월일 불일치(Q201) 등으로 떨어질 수 있는데, 이 메일이 없으면
 * 고객은 마이페이지를 직접 열어보기 전까지 거절 사실을 모른다.
 */
const CMS_REJECTED_TEMPLATE = {
  templateId: FIXED_UUIDS.TEMPLATE_CMS_MEMBER_REJECTED,
  templateKey: 'CMS_MEMBER_REJECTED_EMAIL',
  name: '자동이체 계좌 등록 실패 안내',
  category: 'TRANSACTIONAL',
  // 언어 레이어(`EMAIL.ko`)가 필수다 — 렌더러는 contents.ko.EMAIL 또는 contents.EMAIL.ko 만
  // 찾는다. 이 층을 빼면 제목 "Notification" + 본문 payload JSON 원문으로 나간다.
  contents: {
    EMAIL: {
      ko: {
        subject: '[아몬드영] 자동이체 계좌 등록이 완료되지 않았습니다',
        body: [
          '<p>{{name}}님, 안녕하세요. 아몬드영입니다.</p>',
          '<p>신청해 주신 자동이체 계좌를 확인하는 과정에서 {{reason}} 계좌 등록이 완료되지 않았습니다.</p>',
          '<p>번거로우시겠지만, {{action}} 계좌를 다시 등록해 주세요.',
          ' 재등록해 주시면 확인 절차가 다시 진행됩니다.</p>',
          '<p><a href="{{registerUrl}}">계좌 다시 등록하기</a></p>',
          '<p>이용에 번거로움을 드려 죄송하며, 등록 과정에서 어려움이 있으시면 언제든 문의해 주세요.</p>',
          '<p>문의: <a href="https://pf.kakao.com/_xaxgxazs">카카오톡 채널 아몬드영</a> · 고객센터 1877-7184</p>',
          '<p>감사합니다.<br/>아몬드영 드림</p>',
        ].join('\n'),
      },
    },
  },
  variablesSchema: {
    name: { type: 'string', required: true },
    reason: { type: 'string', required: true },
    action: { type: 'string', required: true },
    registerUrl: { type: 'string', required: true },
  },
};

const CMS_REJECTED_EVENT = {
  eventKey: 'CMS_MEMBER_REJECTED',
  name: '자동이체 계좌 등록 실패 안내',
  description: 'CMS 계좌 심사 최종 거절 시 재등록 안내',
  templateKey: CMS_REJECTED_TEMPLATE.templateKey,
  category: 'TRANSACTIONAL',
  defaultChannels: ['EMAIL'],
  priority: 'HIGH',
};

/**
 * 선적용 가입 안내 — 심사 중(PENDING) 계좌로 멤버십이 시작된 시점.
 *
 * 혜택은 지금부터 쓰지만 첫 출금은 심사 승인 뒤(1~2 영업일)다. 이 사실이 닿는 경로가
 * 가입 직후 토스트와 마이페이지 배너뿐이라, 메일이 없으면 "가입했는데 왜 돈이 안 빠지지"
 * 또는 "언제 빠지는 거지" 가 CS 로 온다.
 *
 * 승인 메일(CMS_MEMBER_REGISTERED_EMAIL)과 이틀 안에 연달아 나가므로 문구가 겹치지 않게 했다
 * — 이쪽은 «지금 쓸 수 있다», 저쪽은 «이제 출금이 걸린다».
 */
const MANDATE_PENDING_TEMPLATE = {
  templateId: FIXED_UUIDS.TEMPLATE_MANDATE_PENDING,
  templateKey: 'MANDATE_PENDING_EMAIL',
  name: '멤버십 선적용 안내',
  category: 'TRANSACTIONAL',
  // 언어 레이어(`EMAIL.ko`)가 필수다 — 위 CMS_REJECTED_TEMPLATE 주석 참고.
  contents: {
    EMAIL: {
      ko: {
        subject: '[아몬드영] 멤버십 혜택이 바로 시작되었습니다',
        body: [
          '<p>{{name}}님, 안녕하세요. 아몬드영입니다.</p>',
          '<p>멤버십 가입이 완료되었습니다. <strong>혜택은 지금 바로 이용하실 수 있습니다.</strong></p>',
          '<p>등록해 주신 자동이체 계좌는 현재 은행 확인이 진행 중입니다(영업일 기준 1~2일).',
          ' <strong>확인이 끝나기 전에는 계좌에서 돈이 빠져나가지 않습니다.</strong></p>',
          '<p>은행에서 받으신 ‘자동이체 등록 접수’ 문자는 접수 확인일 뿐 최종 승인이 아닙니다.',
          ' 확인이 끝나면 승인 여부를 메일로 다시 안내드립니다.</p>',
          '<p><a href="{{membershipUrl}}">멤버십 확인하기</a></p>',
          '<p>문의: <a href="https://pf.kakao.com/_xaxgxazs">카카오톡 채널 아몬드영</a> · 고객센터 1877-7184</p>',
          '<p>감사합니다.<br/>아몬드영 드림</p>',
        ].join('\n'),
      },
    },
  },
  variablesSchema: {
    name: { type: 'string', required: true },
    membershipUrl: { type: 'string', required: true },
  },
};

const MANDATE_PENDING_EVENT = {
  eventKey: 'MANDATE_PENDING',
  name: '멤버십 선적용 안내',
  description: 'CMS 심사 중 계좌로 구독이 시작된 시점 — 혜택 선적용·첫 출금 시점 안내',
  templateKey: MANDATE_PENDING_TEMPLATE.templateKey,
  category: 'TRANSACTIONAL',
  defaultChannels: ['EMAIL'],
  priority: 'HIGH',
};

/**
 * CMS 자동이체 계좌 등록 «승인» 안내. 거절(CMS_REJECTED_TEMPLATE)과 짝이다.
 *
 * 본문은 `apps/notification/scripts/seed-email-templates.js` 의 CMS_MEMBER_REGISTERED_EMAIL 을
 * 그대로 옮긴 것이다. 저 스크립트는 «템플릿만» 다루고 이벤트 매핑을 못 넣는데, 매핑이 없으면
 * 메일이 조용히 안 나간다 — 2026-09-12 라이브가 정확히 그 상태였다(템플릿·매핑 둘 다 없었고,
 * 승인 이벤트가 아직 한 번도 발행되지 않아 유실 전에 발견). 둘을 여기 한 자리에 둔다.
 */
const CMS_REGISTERED_TEMPLATE = {
  templateId: FIXED_UUIDS.TEMPLATE_CMS_MEMBER_REGISTERED,
  templateKey: 'CMS_MEMBER_REGISTERED_EMAIL',
  name: '자동이체 계좌 등록 완료',
  category: 'TRANSACTIONAL',
  // 언어 레이어(`EMAIL.ko`)가 필수다 — 위 CMS_REJECTED_TEMPLATE 주석 참고.
  contents: {
    EMAIL: {
      ko: {
        subject: '[아몬드영] 자동이체 계좌 등록이 완료되었습니다',
        body: '<!doctype html><html lang="ko"><body style="margin:0;padding:0;background-color:#f5f5f5;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:32px 16px;"><tr><td align="center"><table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#ffffff;border-radius:12px;padding:40px 32px;font-family:\'Apple SD Gothic Neo\',\'Malgun Gothic\',sans-serif;"><tr><td style="font-size:22px;font-weight:800;color:#ff6600;padding-bottom:24px;">아몬드영</td></tr><tr><td style="font-size:24px;font-weight:700;color:#111111;padding-bottom:16px;">계좌 등록 완료</td></tr><tr><td style="font-size:15px;line-height:1.6;color:#444444;padding-bottom:24px;">{{name}}님, 안녕하세요.<br/>신청해 주신 자동이체 계좌의 은행 확인이 끝나 등록이 완료되었습니다.</td></tr><tr><td style="padding-bottom:24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f7f7;border:1px solid #e5e5e5;border-radius:10px;padding:20px 24px;"><tr><td style="font-size:14px;color:#888888;padding:4px 0;">은행</td><td align="right" style="font-size:14px;font-weight:600;color:#111111;padding:4px 0;">{{bankName}}</td></tr><tr><td style="font-size:14px;color:#888888;padding:4px 0;">예금주</td><td align="right" style="font-size:14px;font-weight:600;color:#111111;padding:4px 0;">{{payerName}}</td></tr></table></td></tr><tr><td style="font-size:13px;color:#888888;padding-bottom:32px;">앞으로 결제일에 이 계좌에서 자동으로 출금됩니다. 계좌를 바꾸거나 해지하시려면 마이페이지 > 결제수단 관리에서 변경하실 수 있습니다.</td></tr><tr><td style="border-top:1px solid #eeeeee;padding-top:20px;font-size:12px;line-height:1.6;color:#aaaaaa;">본 메일은 발신 전용입니다.<br/>&copy; Almond Young. All rights reserved.</td></tr></table></td></tr></table></body></html>',
      },
    },
  },
  variablesSchema: {
    name: { type: 'string', required: true },
    bankName: { type: 'string', required: true },
    payerName: { type: 'string', required: true },
  },
};

const CMS_REGISTERED_EVENT = {
  eventKey: 'CMS_MEMBER_REGISTERED',
  name: '자동이체 계좌 등록 완료',
  description: 'CMS 계좌 심사 통과 시 등록 완료 안내',
  templateKey: CMS_REGISTERED_TEMPLATE.templateKey,
  category: 'TRANSACTIONAL',
  defaultChannels: ['EMAIL'],
  priority: 'HIGH',
};

const shippedBody = (lead: string) =>
  [
    '<p>{{name}}님, 안녕하세요.</p>',
    `<p>주문하신 <strong>{{orderNumber}}</strong> ${lead}</p>`,
    '<table>',
    '<tr><th>택배사</th><td>{{carrier}}</td></tr>',
    '<tr><th>송장번호</th><td>{{trackingNo}}</td></tr>',
    '</table>',
    '<p>배송 현황은 마이페이지 주문내역에서 확인하실 수 있습니다.</p>',
    '<p>문의: <a href="https://pf.kakao.com/_xaxgxazs">카카오톡 채널 아몬드영</a> · 고객센터 1877-7184</p>',
  ].join('\n');

const SHIPMENT_VARIABLES = {
  name: { type: 'string', required: true },
  orderNumber: { type: 'string', required: true },
  carrier: { type: 'string', required: true },
  trackingNo: { type: 'string', required: true },
};

const ORDER_SHIPPED_TEMPLATE = {
  templateId: FIXED_UUIDS.TEMPLATE_ORDER_SHIPPED,
  templateKey: 'ORDER_SHIPPED_EMAIL',
  name: '발송 완료',
  category: 'TRANSACTIONAL',
  contents: {
    EMAIL: {
      ko: {
        subject: '[아몬드영] 주문하신 상품이 모두 발송되었습니다 ({{orderNumber}})',
        body: shippedBody('주문 상품이 모두 발송되었습니다.'),
      },
    },
  },
  variablesSchema: SHIPMENT_VARIABLES,
};

const ORDER_PARTIALLY_SHIPPED_TEMPLATE = {
  templateId: FIXED_UUIDS.TEMPLATE_ORDER_PARTIALLY_SHIPPED,
  templateKey: 'ORDER_PARTIALLY_SHIPPED_EMAIL',
  name: '부분 발송 완료',
  category: 'TRANSACTIONAL',
  contents: {
    EMAIL: {
      ko: {
        subject: '[아몬드영] 주문하신 상품 중 일부가 먼저 발송되었습니다 ({{orderNumber}})',
        body: shippedBody('주문 상품 중 일부가 먼저 발송되었습니다. 나머지 상품은 준비되는 대로 보내드리겠습니다.'),
      },
    },
  },
  variablesSchema: SHIPMENT_VARIABLES,
};

const ORDER_SHIPPED_EVENT = {
  eventKey: 'ORDER_SHIPPED',
  name: '발송 완료',
  description: '자사몰 주문 상품이 모두 출고되면',
  templateKey: ORDER_SHIPPED_TEMPLATE.templateKey,
  category: 'TRANSACTIONAL',
  defaultChannels: ['EMAIL'],
  priority: 'NORMAL',
  isActive: false,
};

const ORDER_PARTIALLY_SHIPPED_EVENT = {
  eventKey: 'ORDER_PARTIALLY_SHIPPED',
  name: '부분 발송 완료',
  description: '자사몰 주문 상품 중 일부가 먼저 출고되면',
  templateKey: ORDER_PARTIALLY_SHIPPED_TEMPLATE.templateKey,
  category: 'TRANSACTIONAL',
  defaultChannels: ['EMAIL'],
  priority: 'NORMAL',
  isActive: false,
};

const CS_FOOTER =
  '<p>문의: <a href="https://pf.kakao.com/_xaxgxazs">카카오톡 채널 아몬드영</a> · 고객센터 1877-7184</p>';

const CLAIM_VARIABLES = {
  name: { type: 'string', required: true },
  orderNumber: { type: 'string', required: true },
  claimType: { type: 'string', required: true },
};

const csTemplate = (
  templateId: string,
  templateKey: string,
  name: string,
  subject: string,
  lines: string[],
  variablesSchema: Record<string, { type: string; required: boolean }>,
) => ({
  templateId,
  templateKey,
  name,
  category: 'CUSTOMER_SERVICE',
  contents: { EMAIL: { ko: { subject, body: ['<p>{{name}}님, 안녕하세요.</p>', ...lines, CS_FOOTER].join('\n') } } },
  variablesSchema,
});

const csEvent = (eventKey: string, name: string, description: string, templateKey: string) => ({
  eventKey,
  name,
  description,
  templateKey,
  category: 'CUSTOMER_SERVICE',
  defaultChannels: ['EMAIL'],
  priority: 'NORMAL',
  isActive: false,
});

const CS_TEMPLATES = [
  csTemplate(
    FIXED_UUIDS.TEMPLATE_CLAIM_REQUESTED,
    'CLAIM_REQUESTED_EMAIL',
    '반품/교환 신청',
    '[아몬드영] {{claimType}} 신청이 접수되었습니다 ({{orderNumber}})',
    [
      '<p>주문 <strong>{{orderNumber}}</strong>의 {{claimType}} 신청이 접수되었습니다.</p>',
      '<p>확인 후 수거 일정을 안내드리겠습니다. 진행 상황은 마이페이지에서 확인하실 수 있습니다.</p>',
    ],
    CLAIM_VARIABLES,
  ),
  csTemplate(
    FIXED_UUIDS.TEMPLATE_CLAIM_RECEIVED,
    'CLAIM_RECEIVED_EMAIL',
    '반품/교환 접수',
    '[아몬드영] {{claimType}} 요청이 접수되었습니다 ({{orderNumber}})',
    [
      '<p>고객센터에서 주문 <strong>{{orderNumber}}</strong>의 {{claimType}}을 접수했습니다.</p>',
      '<p>확인 후 수거 일정을 안내드리겠습니다. 진행 상황은 마이페이지에서 확인하실 수 있습니다.</p>',
    ],
    CLAIM_VARIABLES,
  ),
  csTemplate(
    FIXED_UUIDS.TEMPLATE_CLAIM_COLLECTED,
    'CLAIM_COLLECTED_EMAIL',
    '수거 완료',
    '[아몬드영] {{claimType}} 상품 수거가 완료되었습니다 ({{orderNumber}})',
    [
      '<p>주문 <strong>{{orderNumber}}</strong>의 {{claimType}} 상품 수거가 완료되었습니다.</p>',
      '<p>상품 검수 후 {{claimType}} 처리를 진행하겠습니다.</p>',
    ],
    CLAIM_VARIABLES,
  ),
  csTemplate(
    FIXED_UUIDS.TEMPLATE_CLAIM_COMPLETED,
    'CLAIM_COMPLETED_EMAIL',
    '반품/교환 완료',
    '[아몬드영] {{claimType}} 처리가 완료되었습니다 ({{orderNumber}})',
    [
      '<p>주문 <strong>{{orderNumber}}</strong>의 {{claimType}} 처리가 완료되었습니다.</p>',
      '<p>환불이 있는 경우 환불 완료 안내를 따로 보내드립니다.</p>',
    ],
    CLAIM_VARIABLES,
  ),
  csTemplate(
    FIXED_UUIDS.TEMPLATE_REFUND_COMPLETED,
    'REFUND_COMPLETED_EMAIL',
    '환불 완료',
    '[아몬드영] {{amount}}원 환불이 완료되었습니다',
    [
      '<p><strong>{{orderName}}</strong> 주문의 환불이 완료되었습니다.</p>',
      '<table>',
      '<tr><th>환불 금액</th><td>{{amount}}원</td></tr>',
      '</table>',
      '<p>결제 수단에 따라 실제 환불 반영까지 며칠이 걸릴 수 있습니다.</p>',
    ],
    {
      name: { type: 'string', required: true },
      amount: { type: 'string', required: true },
      orderName: { type: 'string', required: true },
    },
  ),
  csTemplate(
    FIXED_UUIDS.TEMPLATE_QNA_ANSWERED,
    'QNA_ANSWERED_EMAIL',
    '문의 답변 완료',
    '[아몬드영] 문의하신 내용에 답변이 등록되었습니다',
    [
      '<p>문의하신 <strong>{{title}}</strong>에 답변이 등록되었습니다.</p>',
      '<p>답변 내용은 마이페이지 문의내역에서 확인하실 수 있습니다.</p>',
    ],
    { name: { type: 'string', required: true }, title: { type: 'string', required: true } },
  ),
];

const CS_EVENTS = [
  csEvent('CLAIM_REQUESTED', '반품/교환 신청', '고객이 반품·교환을 신청하면', 'CLAIM_REQUESTED_EMAIL'),
  csEvent('CLAIM_RECEIVED', '반품/교환 접수', '관리자가 반품·교환을 접수하면', 'CLAIM_RECEIVED_EMAIL'),
  csEvent('CLAIM_COLLECTED', '수거 완료', '반품·교환 상품 수거를 완료 처리하면', 'CLAIM_COLLECTED_EMAIL'),
  csEvent('CLAIM_COMPLETED', '반품/교환 완료', '반품·교환 처리가 끝나면', 'CLAIM_COMPLETED_EMAIL'),
  csEvent('REFUND_COMPLETED', '환불 완료', '상품 주문 환불이 완료되면 (취소·반품)', 'REFUND_COMPLETED_EMAIL'),
  csEvent('QNA_ANSWERED', '문의 답변 완료', '상품·1:1 문의에 답변이 등록되면', 'QNA_ANSWERED_EMAIL'),
];

const NAME_ONLY = { name: { type: 'string', required: true } };

const MEMBER_TEMPLATES = [
  csTemplate(
    FIXED_UUIDS.TEMPLATE_USER_WELCOME,
    'USER_WELCOME_EMAIL',
    '회원 가입',
    '[아몬드영] 회원 가입을 환영합니다',
    ['<p>아몬드영 회원이 되신 것을 환영합니다.</p>'],
    NAME_ONLY,
  ),
  csTemplate(
    FIXED_UUIDS.TEMPLATE_USER_WITHDRAWN,
    'USER_WITHDRAWN_EMAIL',
    '회원 탈퇴',
    '[아몬드영] 회원 탈퇴가 완료되었습니다',
    ['<p>회원 탈퇴가 완료되었습니다. 그동안 아몬드영을 이용해 주셔서 감사합니다.</p>', '<p>탈퇴 후 개인정보는 관련 법령에 따라 보관이 필요한 정보를 제외하고 파기됩니다.</p>'],
    NAME_ONLY,
  ),
  csTemplate(
    FIXED_UUIDS.TEMPLATE_MEMBERSHIP_JOINED,
    'MEMBERSHIP_JOINED_EMAIL',
    '멤버십 회원 가입',
    '[아몬드영] 멤버십 가입이 완료되었습니다',
    ['<p>아몬드영 멤버십 가입이 완료되었습니다.</p>', '<p>지금부터 멤버십 전용가와 혜택을 이용하실 수 있습니다. 이용 현황은 마이페이지 멤버십에서 확인하실 수 있습니다.</p>'],
    NAME_ONLY,
  ),
  csTemplate(
    FIXED_UUIDS.TEMPLATE_MEMBERSHIP_CANCELLED,
    'MEMBERSHIP_CANCELLED_EMAIL',
    '멤버십 회원 해지',
    '[아몬드영] 멤버십이 해지되었습니다',
    [
      '<p>아몬드영 멤버십이 해지되었습니다.</p>',
      '<p>{{periodNotice}}</p>',
      '<p>그동안 아몬드영 멤버십과 함께해 주셔서 진심으로 감사합니다.</p>',
      '<p>원장님의 선택에 조금이나마 도움이 되는 멤버십이었기를 바랍니다.<br>잠시 멤버십을 떠나시더라도, 필요해지는 순간 언제든 편하게 다시 찾아주세요.</p>',
      '<p>더 좋은 상품과 더 나은 혜택으로 다시 만나 뵐 수 있도록 계속 노력하겠습니다.</p>',
      '<p>함께해 주셔서 감사합니다.<br>아몬드영 드림</p>',
    ],
    { name: { type: 'string', required: true }, periodNotice: { type: 'string', required: false } },
  ),
  csTemplate(
    FIXED_UUIDS.TEMPLATE_COUPON_EXPIRING,
    'COUPON_EXPIRING_EMAIL',
    '다운로드 쿠폰 만료예정',
    '[아몬드영] 받으신 쿠폰 {{couponCount}}장이 곧 만료됩니다',
    ['<p>받으신 쿠폰이 <strong>{{expiresAt}}</strong>에 만료됩니다.</p>', '<p>{{couponNames}}</p>', '<p>만료 전에 사용해 주세요. 쿠폰은 마이페이지 쿠폰함에서 확인하실 수 있습니다.</p>'],
    {
      name: { type: 'string', required: true },
      couponNames: { type: 'string', required: true },
      couponCount: { type: 'number', required: true },
      expiresAt: { type: 'string', required: true },
    },
  ),
];

const MEMBER_EVENTS = [
  csEvent('USER_WELCOME', '회원 가입', '회원 가입이 완료되면', 'USER_WELCOME_EMAIL'),
  csEvent('USER_WITHDRAWN', '회원 탈퇴', '회원 탈퇴가 완료되면', 'USER_WITHDRAWN_EMAIL'),
  csEvent('MEMBERSHIP_JOINED', '멤버십 회원 가입', '멤버십에 새로 가입하면', 'MEMBERSHIP_JOINED_EMAIL'),
  csEvent('MEMBERSHIP_CANCELLED', '멤버십 회원 해지', '멤버십이 해지되거나 해지 예약되면', 'MEMBERSHIP_CANCELLED_EMAIL'),
  csEvent('COUPON_EXPIRING', '다운로드 쿠폰 만료예정', '내려받은 쿠폰이 3일 안에 만료되면', 'COUPON_EXPIRING_EMAIL'),
];

const NOTICE_TEMPLATES = [
  RENEWAL_NOTICE_TEMPLATE,
  EXPIRY_NOTICE_TEMPLATE,
  CMS_REJECTED_TEMPLATE,
  MANDATE_PENDING_TEMPLATE,
  CMS_REGISTERED_TEMPLATE,
  ORDER_SHIPPED_TEMPLATE,
  ORDER_PARTIALLY_SHIPPED_TEMPLATE,
  ...CS_TEMPLATES,
  ...MEMBER_TEMPLATES,
];
const NOTICE_EVENTS = [
  RENEWAL_NOTICE_EVENT,
  EXPIRY_NOTICE_EVENT,
  CMS_REJECTED_EVENT,
  MANDATE_PENDING_EVENT,
  CMS_REGISTERED_EVENT,
  ORDER_SHIPPED_EVENT,
  ORDER_PARTIALLY_SHIPPED_EVENT,
  ...CS_EVENTS,
  ...MEMBER_EVENTS,
];

const PROVIDER_IDS = [
  FIXED_UUIDS.PROVIDER_FCM_PUSH,
  FIXED_UUIDS.PROVIDER_RESEND_EMAIL,
  FIXED_UUIDS.PROVIDER_NHN_SMS,
  FIXED_UUIDS.PROVIDER_NHN_KAKAO,
];

const PROVIDER_NAMES: Record<string, string> = {
  [FIXED_UUIDS.PROVIDER_FCM_PUSH]: 'FCM Push',
  [FIXED_UUIDS.PROVIDER_RESEND_EMAIL]: 'Resend Email',
  [FIXED_UUIDS.PROVIDER_NHN_SMS]: 'NHN SMS',
  [FIXED_UUIDS.PROVIDER_NHN_KAKAO]: 'NHN KakaoTalk',
};

export class NotificationSeedStep extends SeedStep {
  private notificationConfig: NotificationConfig;

  readonly groups = ['baseline'] as const;

  constructor(databaseUrl: string, config: NotificationConfig) {
    super('Notification', databaseUrl);
    this.notificationConfig = config;
  }

  async check(): Promise<SeedCheckResult> {
    const existing = await this.findExistingIds('notification_providers', PROVIDER_IDS, 'provider_id');
    const missingIds = PROVIDER_IDS.filter((id) => !existing.has(id));

    const existingTemplates = await this.findExistingIds(
      'templates',
      NOTICE_TEMPLATES.map((t) => t.templateId),
      'template_id',
    );
    const existingEvents = await this.findExistingKeys(
      'notification_events',
      NOTICE_EVENTS.map((e) => e.eventKey),
      'event_key',
    );

    const items = [
      {
        entity: 'notification_providers',
        expected: PROVIDER_IDS.length,
        existing: existing.size,
        missing: missingIds.length,
        missingDetails: missingIds.map((id) => PROVIDER_NAMES[id]),
      },
      {
        entity: 'templates',
        expected: NOTICE_TEMPLATES.length,
        existing: existingTemplates.size,
        missing: NOTICE_TEMPLATES.length - existingTemplates.size,
        missingDetails: NOTICE_TEMPLATES.filter((t) => !existingTemplates.has(t.templateId)).map((t) => t.name),
      },
      {
        entity: 'notification_events',
        expected: NOTICE_EVENTS.length,
        existing: existingEvents.size,
        missing: NOTICE_EVENTS.length - existingEvents.size,
        missingDetails: NOTICE_EVENTS.filter((e) => !existingEvents.has(e.eventKey)).map((e) => e.eventKey),
      },
    ];

    const totalMissing = items.reduce((sum, item) => sum + item.missing, 0);
    const isFullySeeded = totalMissing === 0;
    return {
      service: 'Notification',
      items,
      isFullySeeded,
      summary: isFullySeeded ? 'All Notification seed data present' : `${totalMissing} missing record(s)`,
    };
  }

  async apply(): Promise<SeedApplyResult> {
    const start = Date.now();
    const providers = buildProviders(this.notificationConfig);

    try {
      this.logger.step(1, 3, 'Inserting notification providers');
      for (const provider of providers) {
        await this.db.execute(sql`
          INSERT INTO notification_providers (
            provider_id, provider_name, channel, config, status, is_active, priority
          )
          VALUES (
            ${provider.providerId},
            ${provider.providerName},
            ${provider.channel},
            ${JSON.stringify(provider.config)},
            ${provider.status},
            ${true},
            ${provider.priority}
          )
          ON CONFLICT (provider_id) DO NOTHING
        `);
      }

      this.logger.step(2, 3, 'Inserting notification templates');
      for (const template of NOTICE_TEMPLATES) {
        await this.db.execute(sql`
          INSERT INTO templates (template_id, template_key, name, category, contents, variables_schema, is_active)
          VALUES (
            ${template.templateId},
            ${template.templateKey},
            ${template.name},
            ${template.category}::notification_category,
            ${JSON.stringify(template.contents)},
            ${JSON.stringify(template.variablesSchema)},
            ${true}
          )
          ON CONFLICT (template_id) DO NOTHING
        `);
      }

      this.logger.step(3, 3, 'Inserting notification event mappings');
      for (const event of NOTICE_EVENTS) {
        await this.db.execute(sql`
          INSERT INTO notification_events (event_key, name, description, template_key, category, default_channels, priority, is_active)
          VALUES (
            ${event.eventKey},
            ${event.name},
            ${event.description},
            ${event.templateKey},
            ${event.category}::notification_category,
            ${JSON.stringify(event.defaultChannels)},
            ${event.priority}::notification_priority,
            ${'isActive' in event ? event.isActive : true}
          )
          ON CONFLICT (event_key) DO NOTHING
        `);
      }

      this.logger.success('Notification seeding completed');
      return {
        service: 'Notification',
        success: true,
        itemsApplied: providers.length + NOTICE_TEMPLATES.length + NOTICE_EVENTS.length,
        duration: Date.now() - start,
      };
    } catch (error: any) {
      this.logger.error('Notification seeding failed', error);
      return {
        service: 'Notification',
        success: false,
        itemsApplied: 0,
        duration: Date.now() - start,
        error: error.message,
      };
    }
  }
}
