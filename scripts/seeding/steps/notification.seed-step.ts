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

const NOTICE_TEMPLATES = [RENEWAL_NOTICE_TEMPLATE, EXPIRY_NOTICE_TEMPLATE, CMS_REJECTED_TEMPLATE];
const NOTICE_EVENTS = [RENEWAL_NOTICE_EVENT, EXPIRY_NOTICE_EVENT, CMS_REJECTED_EVENT];

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
          ON CONFLICT (template_id) DO UPDATE SET
            contents = EXCLUDED.contents,
            variables_schema = EXCLUDED.variables_schema,
            name = EXCLUDED.name,
            is_active = true,
            updated_at = now()
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
            ${true}
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
