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

@Controller('providers')
export class ProviderController {
    constructor(    
        @InjectTypedDb<typeof notificationTables>() private readonly dbService: DbService<typeof notificationTables>,
        private readonly providerManager: ProviderManagerService,
    ) { }

    private get db() {
        return this.dbService.db;
    }

    @Get()
    @ApiOperation({ summary: '프로바이더 목록 조회', description: '필터 조건에 따라 프로바이더 목록을 조회합니다.' })
    @ApiResponse({ status: 200, description: '프로바이더 목록 조회 성공' })
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
    @ApiOperation({ summary: '프로바이더 상세 조회', description: '특정 프로바이더의 상세 정보를 조회합니다.' })
    @ApiParam({ name: 'id', description: '프로바이더 ID', example: 'provider-123' })
    @ApiResponse({ status: 200, description: '프로바이더 상세 조회 성공' })
    @ApiResponse({ status: 404, description: '프로바이더를 찾을 수 없음' })
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
    @ApiOperation({ summary: '프로바이더 생성', description: '새로운 알림 프로바이더를 생성합니다.' })
    @ApiBody({ type: CreateProviderDto })
    @ApiResponse({ status: 201, description: '프로바이더 생성 성공' })
    @ApiResponse({ status: 400, description: '잘못된 요청 데이터' })
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
    @ApiOperation({ summary: '프로바이더 수정', description: '기존 프로바이더의 설정을 수정합니다.' })
    @ApiParam({ name: 'id', description: '프로바이더 ID', example: 'provider-123' })
    @ApiBody({ type: UpdateProviderDto })
    @ApiResponse({ status: 200, description: '프로바이더 수정 성공' })
    @ApiResponse({ status: 404, description: '프로바이더를 찾을 수 없음' })
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
    @ApiOperation({ summary: '프로바이더 활성화/비활성화 토글', description: '프로바이더의 활성화 상태를 토글합니다.' })
    @ApiParam({ name: 'id', description: '프로바이더 ID', example: 'provider-123' })
    @ApiResponse({ status: 200, description: '프로바이더 상태 토글 성공' })
    @ApiResponse({ status: 404, description: '프로바이더를 찾을 수 없음' })
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
    @ApiOperation({ summary: '프로바이더 삭제', description: '프로바이더를 삭제합니다.' })
    @ApiParam({ name: 'id', description: '프로바이더 ID', example: 'provider-123' })
    @ApiResponse({ status: 204, description: '프로바이더 삭제 성공' })
    @ApiResponse({ status: 404, description: '프로바이더를 찾을 수 없음' })
    async remove(@Param('id') id: string) {
        const result = await this.db
            .delete(notificationProviders)
            .where(eq(notificationProviders.providerId, id))
            .returning({ providerId: notificationProviders.providerId });

        if (result.length === 0) {
            throw new NotFoundException(`Provider ${id} not found`);
        }

        await this.providerManager.reloadProviders();
    }

    @Post(':id/test')
    @ApiOperation({ summary: '프로바이더 테스트', description: '프로바이더의 동작을 테스트합니다.' })
    @ApiParam({ name: 'id', description: '프로바이더 ID', example: 'provider-123' })
    @ApiBody({ type: TestProviderDto })
    @ApiResponse({ status: 200, description: '프로바이더 테스트 성공', type: TestProviderResponseDto })
    @ApiResponse({ status: 404, description: '프로바이더를 찾을 수 없음' })
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
    @ApiOperation({ summary: '프로바이더 상태 확인', description: '프로바이더의 상태와 가용성을 확인합니다.' })
    @ApiParam({ name: 'id', description: '프로바이더 ID', example: 'provider-123' })
    @ApiResponse({ status: 200, description: '프로바이더 상태 확인 성공' })
    @ApiResponse({ status: 404, description: '프로바이더를 찾을 수 없음' })
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
    @ApiOperation({ summary: '채널별 주 프로바이더 조회', description: '특정 채널의 주 프로바이더를 조회합니다.' })
    @ApiParam({ name: 'channel', description: '채널명', example: 'EMAIL' })
    @ApiResponse({ status: 200, description: '주 프로바이더 조회 성공' })
    @ApiResponse({ status: 404, description: '해당 채널의 프로바이더를 찾을 수 없음' })
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
