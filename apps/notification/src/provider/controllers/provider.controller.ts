// apps/notification/src/provider/controllers/provider.controller.ts
import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    Query,
    ValidationPipe,
    HttpCode,
    HttpStatus,
    NotFoundException,
    Headers,
} from '@nestjs/common';

import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { InjectTypedDb } from '@app/db/decorators';
import { notificationTables } from '../../../database/schemas/notification-schema';
import { DbService } from '@app/db';
import { eq, and, desc, asc } from 'drizzle-orm';
import { notificationProviders } from '../../../database/schemas/notification-schema';
import {
    CreateProviderDto,
    UpdateProviderDto,
    ProviderFilterDto,
    TestProviderDto,
    TestProviderResponseDto,
} from '../dto';
import { ProviderManagerService } from '../services/provider-manager.service';
import { ProviderStatus } from '../enums/provider-status.enum';

@ApiTags('providers')

@Controller('api/v1/providers')
export class ProviderController {
    constructor(
        @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
        private readonly providerManager: ProviderManagerService,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    @Get()
    async findAll(@Query(ValidationPipe) filter: ProviderFilterDto) {
        const conditions: any[] = [];

        if (filter.channel) {
            conditions.push(eq(notificationProviders.channel, filter.channel as any));
        }

        if (filter.status) {
            conditions.push(eq(notificationProviders.status, filter.status as any));
        }

        if (filter.isActive !== undefined) {
            conditions.push(eq(notificationProviders.isActive, filter.isActive));
        }

        if (filter.providerName) {
            conditions.push(eq(notificationProviders.providerName, filter.providerName));
        }

        return this.db.query.notificationProviders.findMany({
            where: conditions.length > 0 ? and(...conditions) : undefined,
            orderBy: [
                asc(notificationProviders.channel),
                desc(notificationProviders.priority),
            ],
        });
    }

    @Get(':id')
    async findOne(@Param('id') id: string) {
        const provider = await this.db.query.notificationProviders.findFirst({
            where: eq(notificationProviders.providerId, id),
        });

        if (!provider) {
            throw new NotFoundException(`Provider ${id} not found`);
        }

        return provider;
    }

    @Post()
    async create(@Body(ValidationPipe) dto: CreateProviderDto) {
        const newProvider: any = {
            channel: dto.channel,
            providerName: dto.providerName,
            config: dto.config,
            status: ProviderStatus.ACTIVE,
            isActive: dto.isActive ?? true,
            priority: dto.priority ?? 0,
            capabilities: dto.capabilities,
            metadata: dto.metadata,
        };

        const [provider] = await this.db
            .insert(notificationProviders)
            .values(newProvider)
            .returning();

        await this.providerManager.reloadProviders();

        return provider;
    }

    @Put(':id')
    async update(
        @Param('id') id: string,
        @Body(ValidationPipe) dto: UpdateProviderDto,
    ) {
        const updateData: any = {
            ...dto,
            updatedAt: new Date(),
        };

        const [updated] = await this.db
            .update(notificationProviders)
            .set(updateData)
            .where(eq(notificationProviders.providerId, id))
            .returning();

        if (!updated) {
            throw new NotFoundException(`Provider ${id} not found`);
        }

        if (dto.config || dto.isActive !== undefined) {
            await this.providerManager.reloadProviders();
        }

        return updated;
    }

    @Put(':id/toggle')
    async toggle(@Param('id') id: string) {
        const provider = await this.findOne(id);

        const [updated] = await this.db
            .update(notificationProviders)
            .set({
                isActive: !provider.isActive,
                updatedAt: new Date(),
            })
            .where(eq(notificationProviders.providerId, id))
            .returning();

        await this.providerManager.reloadProviders();

        return updated;
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    async remove(@Param('id') id: string) {
        const result = await this.db
            .delete(notificationProviders)
            .where(eq(notificationProviders.providerId, id));

        if (!result) {
            throw new NotFoundException(`Provider ${id} not found`);
        }

        await this.providerManager.reloadProviders();
    }

    @Post(':id/test')
    async testProvider(
        @Param('id') id: string,
        @Body(ValidationPipe) dto: TestProviderDto,
    ): Promise<TestProviderResponseDto> {
        const provider = await this.providerManager.getProviderById(id);
        if (!provider) {
            throw new NotFoundException(`Provider ${id} not found`);
        }

        const startTime = Date.now();

        try {
            const result = await provider.send({
                to: dto.to,
                content: dto.content,
                subject: dto.subject,
                metadata: {
                    ...dto.metadata,
                    test: true,
                },
            });

            return {
                providerId: id,
                providerName: provider.getName(),
                channel: await this.getProviderChannel(id),
                success: result.success,
                messageId: result.messageId,
                error: result.error,
                latencyMs: Date.now() - startTime,
                timestamp: new Date(),
                providerResponse: result.providerResponse,
            };
        } catch (error: any) {
            return {
                providerId: id,
                providerName: provider.getName(),
                channel: await this.getProviderChannel(id),
                success: false,
                error: error.message,
                latencyMs: Date.now() - startTime,
                timestamp: new Date(),
            };
        }
    }

    @Get(':id/health')
    async checkHealth(@Param('id') id: string) {
        const provider = await this.providerManager.getProviderById(id);
        if (!provider) {
            throw new NotFoundException(`Provider ${id} not found`);
        }

        const isAvailable = await provider.isAvailable();
        const dbProvider = await this.findOne(id);

        return {
            providerId: id,
            providerName: provider.getName(),
            channel: dbProvider.channel,
            status: dbProvider.status,
            isActive: dbProvider.isActive,
            isAvailable,
            lastChecked: new Date(),
        };
    }

    @Get('channels/:channel/primary')
    async getPrimaryProvider(@Param('channel') channel: string) {
        const provider = this.providerManager.getPrimaryProviderForChannel(channel as any);
        if (!provider) {
            throw new NotFoundException(`No provider found for channel ${channel}`);
        }

        const dbProvider = await this.db.query.notificationProviders.findFirst({
            where: and(
                eq(notificationProviders.channel, channel as any),
                eq(notificationProviders.providerId, provider.getProviderId())
            ),
        });

        return dbProvider;
    }

    private async getProviderChannel(providerId: string): Promise<any> {
        const provider = await this.db.query.notificationProviders.findFirst({
            where: eq(notificationProviders.providerId, providerId),
            columns: { channel: true },
        });
        return provider?.channel;
    }
}