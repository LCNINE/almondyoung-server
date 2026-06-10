// apps/notification/src/provider/services/provider-manager.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectTypedDb } from '@app/db/decorators';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { DbService } from '@app/db';
import { eq, and, desc } from 'drizzle-orm';
import {
  notificationProviders,
  NotificationProvider as NotificationProviderEntity,
} from '../../../database/schemas/notification-schema';
import { NotificationProvider } from '../interfaces/notification-provider.interface';
import { Channel } from '../../shared/enums';
import { AlertService } from '../../shared/services/alert.service';
import { NOTIFICATION_CONSTANTS } from '../../shared/constants';
import { ProviderStatus } from '../enums/provider-status.enum';
import { ProviderFactory } from '../factories/provider.factory';
import { StructuredLogger } from '../../shared/utils/logger.utils';

@Injectable()
export class ProviderManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger: StructuredLogger;
  private providers: Map<string, NotificationProvider> = new Map();
  private providersByChannel: Map<Channel, NotificationProvider[]> = new Map();
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(
    @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
    private readonly providerFactory: ProviderFactory,
    private readonly alertService: AlertService,
    private readonly configService: ConfigService,
  ) {
    this.logger = new StructuredLogger(new Logger(ProviderManagerService.name));
  }

  private get db() {
    return this.dbService.db;
  }

  async onModuleInit() {
    await this.loadProviders();
    await this.startHealthChecks();
  }

  async onModuleDestroy() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    this.providers.clear();
    this.providersByChannel.clear();
  }

  async reloadProviders() {
    this.logger.log('Reloading providers', {});
    this.providers.clear();
    this.providersByChannel.clear();
    await this.loadProviders();
  }

  async getProviderById(providerId: string): Promise<NotificationProvider | null> {
    return this.providers.get(providerId) || null;
  }

  async getProvidersByChannel(channel: Channel): Promise<NotificationProvider[]> {
    return this.providersByChannel.get(channel) || [];
  }

  private async loadProviders() {
    // const dbProviders = await this.db.query.notificationProviders.findMany({
    //     where: eq(notificationProviders.isActive, true),
    //     orderBy: desc(notificationProviders.priority),
    // });
    const dbProviders = [
      {
        providerId: 'a419caa1-b359-4647-9ab4-0a9b69e56310',
        providerName: 'FCM Push',
        isAvailable: true,
        channel: Channel.PUSH,
        priority: 10,
        config: {
          timeout: 30000,
          clientId: '107487182970332379639',
          projectId: 'notification-service-a5dff',
          privateKey: '',
          clientEmail: 'firebase-adminsdk-fbsvc@notification-service-a5dff.iam.gserviceaccount.com',
          privateKeyId: '33b8b49babb281a4d4b89e19486ab856d2095649',
        },
      },
      {
        providerId: '3b5056a7-d706-4525-b945-f70bff410589',
        providerName: 'Resend Email',
        isAvailable: true,
        channel: Channel.EMAIL,
        priority: 10,
        config: {
          apiKey: this.configService.get<string>('RESEND_API_KEY') || '',
          baseUrl: this.configService.get<string>('RESEND_BASE_URL') || 'https://api.resend.com',
          timeout: 30000,
          fromName: this.configService.get<string>('RESEND_FROM_NAME') || 'Almond Young',
          fromEmail: this.configService.get<string>('RESEND_FROM') || 'noreply@almondyoung.com',
          maxRetries: 3,
          retryDelay: 1000,
        },
      },
      {
        providerId: 'b093c040-9de2-4b42-8ace-861753e02658',
        providerName: 'Twilio SMS',
        isAvailable: true,
        channel: Channel.SMS,
        priority: 10,
        config: {
          timeout: 30000,
          authToken: '',
          accountSid: '',
          fromNumber: '+15856342856',
          messagingServiceSid: '',
          enableDeliveryReports: true,
        },
      },
      {
        providerId: 'd490c11d-70f1-409c-a6af-a715d1d746ff',
        providerName: 'NHN KakaoTalk',
        isAvailable: true,
        channel: Channel.KAKAO,
        priority: 10,
        config: {
          apiUrl: this.configService.get<string>('NHN_API_URL') || 'https://api-alimtalk.cloud.toast.com',
          appKey: this.configService.get<string>('NHN_APP_KEY') || '',
          timeout: 30000,
          secretKey: this.configService.get<string>('NHN_SECRET_KEY') || '',
          senderKey: this.configService.get<string>('NHN_SENDER_KEY') || '',
          plusFriendId: this.configService.get<string>('NHN_PLUS_FRIEND_ID') || '@아몬드영',
          resendAppKey: this.configService.get<string>('NHN_SMS_APP_KEY') || '',
        },
      },
    ];

    for (const dbProvider of dbProviders) {
      try {
        const provider = this.providerFactory.create(
          dbProvider.providerName,
          dbProvider.providerId,
          dbProvider.config as Record<string, any>,
        );

        if (!provider) {
          this.logger.warn('Unknown provider type', {
            providerName: dbProvider.providerName,
            providerId: dbProvider.providerId,
          });
          continue;
        }

        // 초기 헬스체크
        const isAvailable = await provider.isAvailable();
        if (!isAvailable) {
          this.logger.warn('Provider not available during initialization', {
            providerId: dbProvider.providerId,
            providerName: dbProvider.providerName,
          });
        }

        this.providers.set(dbProvider.providerId, provider);

        const channel = dbProvider.channel;
        if (!this.providersByChannel.has(channel)) {
          this.providersByChannel.set(channel, []);
        }
        this.providersByChannel.get(channel)!.push(provider);

        this.logger.log('Provider loaded successfully', {
          providerId: dbProvider.providerId,
          providerName: dbProvider.providerName,
          channel,
          isAvailable,
        });
      } catch (error: any) {
        this.logger.error(
          'Failed to load provider',
          {
            providerId: dbProvider.providerId,
            providerName: dbProvider.providerName,
            error: error.message,
          },
          error.stack,
        );

        // Provider 상태를 ERROR로 업데이트
        await this.db
          .update(notificationProviders)
          .set({
            status: ProviderStatus.ERROR,
            metadata: {
              lastError: error.message,
              lastErrorAt: new Date().toISOString(),
            },
            updatedAt: new Date(),
          })
          .where(eq(notificationProviders.providerId, dbProvider.providerId));
      }
    }

    this.logger.log('Providers loaded', {
      totalProviders: this.providers.size,
      channels: Array.from(this.providersByChannel.keys()),
    });
  }

  getPrimaryProviderForChannel(channel: Channel): NotificationProvider | null {
    const providers = this.providersByChannel.get(channel) || [];

    if (providers.length === 0) {
      this.logger.warn('No providers configured for channel', { channel });
      return null;
    }

    return providers[0] || null;
  }

  async getAvailableProviderForChannel(channel: Channel): Promise<NotificationProvider | null> {
    const providers = this.providersByChannel.get(channel) || [];

    // 채널에 등록된 프로바이더가 없는 경우
    if (providers.length === 0) {
      this.logger.error('No providers configured for channel', {
        channel,
        availableChannels: Array.from(this.providersByChannel.keys()),
      });

      await this.alertService.createAlert({
        type: 'provider_not_configured',
        severity: 'critical',
        title: `No providers configured for channel ${channel}`,
        message: `Channel ${channel} has no registered providers. Please configure at least one provider for this channel.`,
        context: {
          channel,
          availableChannels: Array.from(this.providersByChannel.keys()),
        },
      });

      return null;
    }

    // 사용 가능한 프로바이더 찾기
    for (const provider of providers) {
      try {
        if (await provider.isAvailable()) {
          return provider;
        }
      } catch (error: any) {
        this.logger.warn('Provider availability check failed', {
          providerId: provider.getProviderId(),
          channel,
          error: error.message,
        });
      }
    }

    // 모든 provider가 unavailable한 경우
    this.logger.error('All providers unavailable for channel', {
      channel,
      providerCount: providers.length,
      providerIds: providers.map((p) => p.getProviderId()),
    });

    await this.alertService.createAlert({
      type: 'provider_unavailable',
      severity: 'critical',
      title: `No available providers for ${channel}`,
      message: `All ${providers.length} provider(s) for channel ${channel} are unavailable`,
      context: {
        channel,
        attemptedProviders: providers.map((p) => p.getProviderId()),
      },
    });

    return null;
  }

  private async startHealthChecks() {
    // 즉시 한 번 실행
    await this.performHealthChecks();

    // 주기적으로 실행
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, NOTIFICATION_CONSTANTS.HEALTH_CHECK_INTERVAL);
  }

  private async performHealthChecks() {
    const healthCheckResults: Array<{
      providerId: string;
      providerName: string;
      isAvailable: boolean;
      error?: string;
    }> = [];

    for (const [providerId, provider] of this.providers.entries()) {
      try {
        const isAvailable = await provider.isAvailable();

        healthCheckResults.push({
          providerId,
          providerName: provider.getName(),
          isAvailable,
        });

        // 기존 metadata를 유지하면서 업데이트
        // 개발 중 임시로 지속적인 DB 접근 차단
        // const existingProvider = await this.db.query.notificationProviders.findFirst({
        //     where: eq(notificationProviders.providerId, providerId),
        // });

        // const existingMetadata = existingProvider?.metadata || {};
        //
        // await this.db
        //     .update(notificationProviders)
        //     .set({
        //         status: isAvailable ? ProviderStatus.ACTIVE : ProviderStatus.ERROR,
        //         metadata: {
        //             ...existingMetadata,
        //             lastHealthCheck: new Date().toISOString(),
        //             isHealthy: isAvailable,
        //             // 에러 정보는 health check 성공 시 제거하지 않음 (이력 유지)
        //         },
        //         updatedAt: new Date(),
        //     })
        //     .where(eq(notificationProviders.providerId, providerId));

        if (!isAvailable) {
          await this.alertService.createAlert({
            type: 'provider_health_check_failed',
            severity: 'high',
            title: `Provider ${provider.getName()} is unavailable`,
            message: `Health check failed for provider ${provider.getName()}`,
            context: {
              providerId,
              providerName: provider.getName(),
            },
          });
        }
      } catch (error: any) {
        this.logger.error(
          'Health check failed',
          {
            providerId,
            providerName: provider.getName(),
            error: error.message,
          },
          error.stack,
        );

        healthCheckResults.push({
          providerId,
          providerName: provider.getName(),
          isAvailable: false,
          error: error.message,
        });

        // 헬스체크 에러 시에도 DB 상태를 ERROR로 갱신
        // 개발 중 임시로 지속적인 DB 접근 차단
        // const existingProvider = await this.db.query.notificationProviders.findFirst({
        //     where: eq(notificationProviders.providerId, providerId),
        // });

        // const existingMetadata = existingProvider?.metadata || {};

        // await this.db
        //     .update(notificationProviders)
        //     .set({
        //         status: ProviderStatus.ERROR,
        //         metadata: {
        //             ...existingMetadata,
        //             lastHealthCheck: new Date().toISOString(),
        //             isHealthy: false,
        //             lastError: error.message,
        //             lastErrorAt: new Date().toISOString(),
        //         },
        //         updatedAt: new Date(),
        //     })
        //     .where(eq(notificationProviders.providerId, providerId));

        await this.alertService.createAlert({
          type: 'provider_health_check_error',
          severity: 'high',
          title: `Provider ${provider.getName()} health check error`,
          message: `Health check failed for provider ${provider.getName()}: ${error.message}`,
          context: {
            providerId,
            providerName: provider.getName(),
            error: error.message,
          },
        });
      }
    }

    this.logger.log('Health check completed', {
      results: healthCheckResults,
    });
  }
}
