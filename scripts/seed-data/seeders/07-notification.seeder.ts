import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { Logger } from '../shared/logger';
import { FIXED_UUIDS } from '../constants/uuids';

const logger = new Logger('Notification Seeder');

interface NotificationProvider {
  providerId: string;
  providerName: string;
  channel: 'EMAIL' | 'SMS' | 'KAKAO' | 'PUSH';
  config: Record<string, any>;
  status: 'ACTIVE' | 'INACTIVE';
  isActive: boolean;
  priority: number;
}

export async function seedNotification(
  databaseUrl: string,
  fcmPrivateKey: string,
  twilioAuthToken: string,
  twilioAccountSid: string,
  nhnSecretKey: string,
): Promise<void> {
  logger.info('Starting Notification seeding');

  const sql = postgres(databaseUrl);
  const db = drizzle(sql);

  try {
    // Step 1: Insert Notification Providers
    logger.step(1, 1, 'Inserting notification providers');

    const providers: NotificationProvider[] = [
      {
        providerId: FIXED_UUIDS.PROVIDER_FCM_PUSH,
        providerName: 'FCM Push',
        channel: 'PUSH',
        config: {
          timeout: 30000,
          clientId: '107487182970332379639',
          projectId: 'notification-service-a5dff',
          privateKey: fcmPrivateKey,
          clientEmail:
            'firebase-adminsdk-fbsvc@notification-service-a5dff.iam.gserviceaccount.com',
          privateKeyId: '33b8b49babb281a4d4b89e19486ab856d2095649',
        },
        status: 'ACTIVE',
        isActive: true,
        priority: 10,
      },
      {
        providerId: FIXED_UUIDS.PROVIDER_RESEND_EMAIL,
        providerName: 'Resend Email',
        channel: 'EMAIL',
        config: {
          apiKey: 're_L5T64k9X_PUJsu8kKModEQbJBQh1uvoUg',
          baseUrl: 'https://api.resend.com',
          timeout: 30000,
          fromName: 'Almond Young',
          fromEmail: 'noreply@almondyoung.com',
          maxRetries: 3,
          retryDelay: 1000,
        },
        status: 'ACTIVE',
        isActive: true,
        priority: 10,
      },
      {
        providerId: FIXED_UUIDS.PROVIDER_TWILIO_SMS,
        providerName: 'Twilio SMS',
        channel: 'SMS',
        config: {
          timeout: 30000,
          authToken: twilioAuthToken,
          accountSid: twilioAccountSid,
          fromNumber: '+15856342856',
          messagingServiceSid: '',
          enableDeliveryReports: true,
        },
        status: 'ACTIVE',
        isActive: true,
        priority: 10,
      },
      {
        providerId: FIXED_UUIDS.PROVIDER_NHN_KAKAO,
        providerName: 'NHN KakaoTalk',
        channel: 'KAKAO',
        config: {
          apiUrl: 'https://api-alimtalk.cloud.toast.com',
          appKey: '56ySy3UiPmNhryr8',
          timeout: 30000,
          secretKey: nhnSecretKey,
          senderKey: '4bd6430a65cad17d327c758006e5cf4a773d82e6',
          plusFriendId: '@아몬드영',
          resendAppKey: '',
        },
        status: 'ACTIVE',
        isActive: true,
        priority: 10,
      },
    ];

    for (const provider of providers) {
      await db.execute(sql`
        INSERT INTO notification_providers (
          provider_id, provider_name, channel, config, status, is_active, priority
        )
        VALUES (
          ${provider.providerId},
          ${provider.providerName},
          ${provider.channel},
          ${JSON.stringify(provider.config)},
          ${provider.status},
          ${provider.isActive},
          ${provider.priority}
        )
        ON CONFLICT (provider_id) DO NOTHING
      `);
    }

    logger.success(`Inserted ${providers.length} notification providers`);
    logger.success('Notification seeding completed successfully');
  } catch (error) {
    logger.error('Notification seeding failed', error);
    throw error;
  } finally {
    await sql.end();
  }
}
