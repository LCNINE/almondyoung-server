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

    const items = [
      {
        entity: 'notification_providers',
        expected: PROVIDER_IDS.length,
        existing: existing.size,
        missing: missingIds.length,
        missingDetails: missingIds.map((id) => PROVIDER_NAMES[id]),
      },
    ];

    const isFullySeeded = missingIds.length === 0;
    return {
      service: 'Notification',
      items,
      isFullySeeded,
      summary: isFullySeeded ? 'All Notification seed data present' : `${missingIds.length} missing record(s)`,
    };
  }

  async apply(): Promise<SeedApplyResult> {
    const start = Date.now();
    const providers = buildProviders(this.notificationConfig);

    try {
      this.logger.step(1, 1, 'Inserting notification providers');
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

      this.logger.success('Notification seeding completed');
      return { service: 'Notification', success: true, itemsApplied: providers.length, duration: Date.now() - start };
    } catch (error: any) {
      this.logger.error('Notification seeding failed', error);
      return { service: 'Notification', success: false, itemsApplied: 0, duration: Date.now() - start, error: error.message };
    }
  }
}
