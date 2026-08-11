import { sql } from 'drizzle-orm';
import { SeedStep } from './base-seed-step';
import { SeedCheckResult, SeedApplyResult } from '../lib/types';
import { FIXED_UUIDS } from '../constants/uuids';

export interface NotificationConfig {
  fcmPrivateKey: string;
  resendApiKey: string;
  twilioAuthToken: string;
  twilioAccountSid: string;
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
      providerId: FIXED_UUIDS.PROVIDER_TWILIO_SMS,
      providerName: 'Twilio SMS',
      channel: 'SMS',
      config: {
        timeout: 30000,
        authToken: config.twilioAuthToken,
        accountSid: config.twilioAccountSid,
        fromNumber: '+15856342856',
        messagingServiceSid: '',
        enableDeliveryReports: true,
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
  contents: {
    EMAIL: {
      subject: '[아몬드영] {{formatDate nextBillingDate}} 멤버십이 자동 갱신됩니다',
      body: [
        '<p>{{userName}}님, 안녕하세요.</p>',
        '<p>이용 중인 <strong>{{planName}}</strong> 멤버십이 <strong>{{formatDate nextBillingDate}}</strong>에 자동 갱신될 예정입니다.',
        ' 결제 예정일 {{noticeDaysBefore}}일 전에 미리 안내드립니다.</p>',
        '<table>',
        '<tr><th>결제 예정일</th><td>{{formatDate nextBillingDate}}</td></tr>',
        '<tr><th>결제 예정 금액</th><td>{{formatCurrency amount}}</td></tr>',
        '<tr><th>결제 수단</th><td>{{paymentMethodLabel}}</td></tr>',
        '<tr><th>갱신 후 이용 기간</th><td>{{formatDate nextBillingDate}} ~ {{formatDate nextPeriodEnd}}</td></tr>',
        '</table>',
        '<p>갱신을 원하지 않으시면 <strong>{{formatDate nextBillingDate}} 전까지</strong> 아래에서 해지해 주세요.',
        ' 해지하셔도 이미 결제하신 기간({{formatDate currentPeriodEnd}}까지)은 그대로 이용하실 수 있습니다.</p>',
        '<p><a href="{{manageUrl}}">멤버십 관리 · 해지하기</a></p>',
        '<p>문의: 고객센터 1877-7184</p>',
        '<p>본 메일은 전자상거래법에 따른 계속거래 갱신 사전 고지 안내로, 수신거부 대상이 아닙니다.</p>',
      ].join('\n'),
    },
  },
  variablesSchema: {
    userName: { type: 'string', required: true },
    planName: { type: 'string', required: true },
    nextBillingDate: { type: 'string', required: true },
    amount: { type: 'number', required: true },
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

const PROVIDER_IDS = [
  FIXED_UUIDS.PROVIDER_FCM_PUSH,
  FIXED_UUIDS.PROVIDER_RESEND_EMAIL,
  FIXED_UUIDS.PROVIDER_TWILIO_SMS,
  FIXED_UUIDS.PROVIDER_NHN_KAKAO,
];

const PROVIDER_NAMES: Record<string, string> = {
  [FIXED_UUIDS.PROVIDER_FCM_PUSH]: 'FCM Push',
  [FIXED_UUIDS.PROVIDER_RESEND_EMAIL]: 'Resend Email',
  [FIXED_UUIDS.PROVIDER_TWILIO_SMS]: 'Twilio SMS',
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
      [RENEWAL_NOTICE_TEMPLATE.templateId],
      'template_id',
    );
    const existingEvents = await this.findExistingKeys('notification_events', [RENEWAL_NOTICE_EVENT.eventKey], 'event_key');

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
        expected: 1,
        existing: existingTemplates.size,
        missing: 1 - existingTemplates.size,
        missingDetails: existingTemplates.size === 0 ? [RENEWAL_NOTICE_TEMPLATE.name] : [],
      },
      {
        entity: 'notification_events',
        expected: 1,
        existing: existingEvents.size,
        missing: 1 - existingEvents.size,
        missingDetails: existingEvents.size === 0 ? [RENEWAL_NOTICE_EVENT.eventKey] : [],
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
      await this.db.execute(sql`
        INSERT INTO templates (template_id, template_key, name, category, contents, variables_schema, is_active)
        VALUES (
          ${RENEWAL_NOTICE_TEMPLATE.templateId},
          ${RENEWAL_NOTICE_TEMPLATE.templateKey},
          ${RENEWAL_NOTICE_TEMPLATE.name},
          ${RENEWAL_NOTICE_TEMPLATE.category}::notification_category,
          ${JSON.stringify(RENEWAL_NOTICE_TEMPLATE.contents)},
          ${JSON.stringify(RENEWAL_NOTICE_TEMPLATE.variablesSchema)},
          ${true}
        )
        ON CONFLICT (template_id) DO NOTHING
      `);

      this.logger.step(3, 3, 'Inserting notification event mappings');
      await this.db.execute(sql`
        INSERT INTO notification_events (event_key, name, description, template_key, category, default_channels, priority, is_active)
        VALUES (
          ${RENEWAL_NOTICE_EVENT.eventKey},
          ${RENEWAL_NOTICE_EVENT.name},
          ${RENEWAL_NOTICE_EVENT.description},
          ${RENEWAL_NOTICE_EVENT.templateKey},
          ${RENEWAL_NOTICE_EVENT.category}::notification_category,
          ${JSON.stringify(RENEWAL_NOTICE_EVENT.defaultChannels)},
          ${RENEWAL_NOTICE_EVENT.priority}::notification_priority,
          ${true}
        )
        ON CONFLICT (event_key) DO NOTHING
      `);

      this.logger.success('Notification seeding completed');
      return { service: 'Notification', success: true, itemsApplied: providers.length + 2, duration: Date.now() - start };
    } catch (error: any) {
      this.logger.error('Notification seeding failed', error);
      return { service: 'Notification', success: false, itemsApplied: 0, duration: Date.now() - start, error: error.message };
    }
  }
}
