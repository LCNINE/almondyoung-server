import { drizzle } from 'drizzle-orm/postgres-js';
import { InferInsertModel, sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as notificationSchema from '../../../apps/notification/database/schemas/notification-schema';
import { Logger } from '../shared/logger';
import { FIXED_UUIDS } from '../constants/uuids';

const logger = new Logger('Notification Seeder');

type NotificationProviderInsert = InferInsertModel<typeof notificationSchema.notificationProviders>;

export async function seedNotification(
  databaseUrl: string,
  fcmPrivateKey: string,
  resendApiKey: string,
  twilioAuthToken: string,
  twilioAccountSid: string,
  nhnAppKey: string,
  nhnSecretKey: string,
  nhnSenderKey: string,
): Promise<void> {
  logger.info('Starting Notification seeding');

  const client = postgres(databaseUrl);
  const db = drizzle(client);

  try {
    // Step 1: Insert Notification Providers
    logger.step(1, 1, 'Inserting notification providers');

    const providers: NotificationProviderInsert[] = [
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
          apiKey: resendApiKey,
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
          appKey: nhnAppKey,
          timeout: 30000,
          secretKey: nhnSecretKey,
          senderKey: nhnSenderKey,
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
    await client.end();
  }
}
