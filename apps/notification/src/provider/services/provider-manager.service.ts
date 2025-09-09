// apps/notification/src/provider/services/provider-manager.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
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
        const dbProviders = await this.db.query.notificationProviders.findMany({
            where: eq(notificationProviders.isActive, true),
            orderBy: desc(notificationProviders.priority),
        });

        for (const dbProvider of dbProviders) {
            try {
                const provider = this.providerFactory.create(
                    dbProvider.providerName,
                    dbProvider.providerId,
                    dbProvider.config as Record<string, any>
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

                const channel = dbProvider.channel as Channel;
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
                this.logger.error('Failed to load provider', {
                    providerId: dbProvider.providerId,
                    providerName: dbProvider.providerName,
                    error: error.message,
                }, error.stack);

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
        return providers[0] || null;
    }

    async getAvailableProviderForChannel(channel: Channel): Promise<NotificationProvider | null> {
        const providers = this.providersByChannel.get(channel) || [];

        for (const provider of providers) {
            try {
                if (await provider.isAvailable()) {
                    return provider;
                }
            } catch (error: any) {
                this.logger.warn('Provider availability check failed', {
                    providerId: provider.getProviderId(),
                    error: error.message,
                });
            }
        }

        // 모든 provider가 unavailable한 경우
        await this.alertService.createAlert({
            type: 'provider_unavailable',
            severity: 'critical',
            title: `No available providers for ${channel}`,
            message: `All providers for channel ${channel} are unavailable`,
            context: {
                channel,
                attemptedProviders: providers.map(p => p.getProviderId()),
            },
        });

        return null;
    }

    private async startHealthChecks() {
        // 즉시 한 번 실행
        await this.performHealthChecks();

        // 주기적으로 실행
        this.healthCheckInterval = setInterval(
            async () => {
                await this.performHealthChecks();
            },
            NOTIFICATION_CONSTANTS.HEALTH_CHECK_INTERVAL
        );
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

                await this.db
                    .update(notificationProviders)
                    .set({
                        status: isAvailable ? ProviderStatus.ACTIVE : ProviderStatus.ERROR,
                        metadata: {
                            lastHealthCheck: new Date().toISOString(),
                            isHealthy: isAvailable,
                        },
                        updatedAt: new Date(),
                    })
                    .where(eq(notificationProviders.providerId, providerId));

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
                this.logger.error('Health check failed', {
                    providerId,
                    providerName: provider.getName(),
                    error: error.message,
                }, error.stack);

                healthCheckResults.push({
                    providerId,
                    providerName: provider.getName(),
                    isAvailable: false,
                    error: error.message,
                });
            }
        }

        this.logger.log('Health check completed', {
            results: healthCheckResults,
        });
    }
}