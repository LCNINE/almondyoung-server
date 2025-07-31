import {
    Injectable,
    InternalServerErrorException,
    NotFoundException,
    BadRequestException,
    Logger,
} from '@nestjs/common';
import { DbService, InjectDb } from '@app/db';
import * as schema from '../../shared/schemas/schema';
import { ulid } from 'ulid';
import { and, eq, SQL, desc, lt } from 'drizzle-orm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
    CreatePaymentSessionDto,
    UpdatePaymentSessionDto,
} from '../dto';
import {
    PaymentSession,
    PaymentSessionInsert,
    PaymentSessionStatus,

} from '../types';

@Injectable()
export class PaymentSessionService {
    private readonly logger = new Logger(PaymentSessionService.name);
    private readonly DEFAULT_EXPIRATION_MINUTES = 30;

    constructor(
        @InjectDb() private readonly dbService: DbService<typeof schema>,
        private readonly eventEmitter: EventEmitter2,
    ) { }

    /**
     * 단일 PaymentSession을 조회합니다.
     */
    async findById(id: string): Promise<PaymentSession | null> {
        const result = await this.dbService.db.query.paymentSessions.findFirst({
            where: eq(schema.paymentSessions.id, id),
        });

        return result || null;
    }

    /**
     * 플랫폼 참조 ID로 PaymentSession을 조회합니다.
     */


    /**
     * 여러 PaymentSession을 조회합니다.
     */
    async findAll(
        userId?: string,
        status?: PaymentSessionStatus,
   
    ): Promise<PaymentSession[]> {
        let whereCondition;

        if (userId || status ) {
            const conditions: SQL[] = [];

            if (userId) {
                conditions.push(eq(schema.paymentSessions.userId, userId));
            }
            if (status) {
                conditions.push(eq(schema.paymentSessions.status, status));
            }


            whereCondition = conditions.length === 1 ? conditions[0] : and(...conditions);
        }

        const results = await this.dbService.db.query.paymentSessions.findMany({
            where: whereCondition,
            orderBy: [desc(schema.paymentSessions.createdAt)],
        });

        return results;
    }

    /**
     * 새로운 PaymentSession을 생성합니다.
     */
    async create(dto: CreatePaymentSessionDto): Promise<PaymentSession> {
        const { userId, amount, currency, metadata, expiresInMinutes } = dto;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + (expiresInMinutes || this.DEFAULT_EXPIRATION_MINUTES) * 60 * 1000);



        const insertData: PaymentSessionInsert = {
            userId,
            amount,
            currency,
            status: 'PENDING',
            metadata: metadata ? JSON.stringify(metadata) : null,
            expiresAt,
            createdAt: now,
            updatedAt: now,
        };

        const newSession = await this.dbService.db.transaction(async (tx) => {
            const [created] = await tx
                .insert(schema.paymentSessions)
                .values(insertData)
                .returning();

            return created;
        });

        // 세션 생성 이벤트 발행
        this.eventEmitter.emit('payment-session.created', {
            paymentSessionId: newSession.id,
            userId,
            amount,
            currency,
            createdAt: now,
        });

        this.logger.log(`PaymentSession created: ${newSession.id} for user ${userId}`);

        const result = await this.findById(newSession.id);
        if (!result) {
            throw new InternalServerErrorException('Could not retrieve payment session after creation');
        }

        return result;
    }

    /**
     * PaymentSession의 상태를 업데이트합니다.
     */
    async updateStatus(id: string, status: PaymentSessionStatus): Promise<PaymentSession> {
        const now = new Date();
        const updateData: Partial<PaymentSessionInsert> = {
            status,
            updatedAt: now,
        };

        // 상태별 타임스탬프 설정
        if (status === 'AUTHORIZED') {
            updateData.authorizedAt = now;
        } else if (status === 'CAPTURED') {
            updateData.capturedAt = now;
        }

        let oldStatus: PaymentSessionStatus = 'PENDING';

        await this.dbService.db.transaction(async (tx) => {
            // 존재 여부 확인
            const existing = await tx.query.paymentSessions.findFirst({
                where: eq(schema.paymentSessions.id, id),
                columns: { id: true, status: true },
            });

            if (!existing) {
                throw new NotFoundException(`PaymentSession with ID ${id} not found`);
            }

            oldStatus = existing.status as PaymentSessionStatus;

            // 상태 전환 유효성 검증
            this.validateStatusTransition(oldStatus, status);

            await tx
                .update(schema.paymentSessions)
                .set(updateData)
                .where(eq(schema.paymentSessions.id, id));
        });

        // 상태 변경 이벤트 발행
        this.eventEmitter.emit('payment-session.status-updated', {
            paymentSessionId: id,
            oldStatus,
            newStatus: status,
            updatedAt: now,
        });

        this.logger.log(`PaymentSession ${id} status updated to ${status}`);

        const result = await this.findById(id);
        return result!;
    }

    /**
     * PaymentSession을 업데이트합니다.
     */
    async update(id: string, dto: UpdatePaymentSessionDto): Promise<PaymentSession> {
        const now = new Date();
        const updateData: Partial<PaymentSessionInsert> = {
            updatedAt: now,
        };

        if (dto.status) {
            updateData.status = dto.status;
            if (dto.status === 'AUTHORIZED') {
                updateData.authorizedAt = dto.authorizedAt || now;
            } else if (dto.status === 'CAPTURED') {
                updateData.capturedAt = dto.capturedAt || now;
            }
        }

        if (dto.metadata) {
            updateData.metadata = JSON.stringify(dto.metadata);
        }

        await this.dbService.db.transaction(async (tx) => {
            const existing = await tx.query.paymentSessions.findFirst({
                where: eq(schema.paymentSessions.id, id),
                columns: { id: true },
            });

            if (!existing) {
                throw new NotFoundException(`PaymentSession with ID ${id} not found`);
            }

            await tx
                .update(schema.paymentSessions)
                .set(updateData)
                .where(eq(schema.paymentSessions.id, id));
        });

        this.logger.log(`PaymentSession ${id} updated`);

        const result = await this.findById(id);
        return result!;
    }

    /**
     * 만료된 PaymentSession들을 정리합니다.
     */
    @Cron(CronExpression.EVERY_5_MINUTES)
    async cleanup(): Promise<void> {
        this.logger.log('Starting expired payment sessions cleanup');

        try {
            const now = new Date();

            // 만료된 PENDING 세션들을 찾아서 FAILED로 변경
            const expiredSessions = await this.dbService.db.query.paymentSessions.findMany({
                where: and(
                    eq(schema.paymentSessions.status, 'PENDING'),
                    lt(schema.paymentSessions.expiresAt, now),
                ),
                columns: { id: true },
            });

            if (expiredSessions.length > 0) {
                await Promise.all(
                    expiredSessions.map(session =>
                        this.updateStatus(session.id, 'FAILED')
                    )
                );

                this.logger.log(`Cleaned up ${expiredSessions.length} expired payment sessions`);
            }
        } catch (error) {
            this.logger.error('Error during payment sessions cleanup', error);
        }
    }

    /**
     * 상태 전환 유효성을 검증합니다.
     */
    private validateStatusTransition(currentStatus: PaymentSessionStatus, newStatus: PaymentSessionStatus): void {
        const validTransitions: Record<PaymentSessionStatus, PaymentSessionStatus[]> = {
            PENDING: ['AUTHORIZED', 'FAILED', 'CANCELLED'],
            AUTHORIZED: ['CAPTURED', 'FAILED', 'CANCELLED'],
            CAPTURED: ['REFUNDED'],
            FAILED: [], // 실패 상태에서는 전환 불가
            CANCELLED: [], // 취소 상태에서는 전환 불가
            REFUNDED: [], // 환불 상태에서는 전환 불가
        };

        const allowedStatuses = validTransitions[currentStatus] || [];
        if (!allowedStatuses.includes(newStatus)) {
            throw new BadRequestException(
                `Invalid status transition from ${currentStatus} to ${newStatus}`,
            );
        }
    }

    /**
     * PaymentSession이 만료되었는지 확인합니다.
     */
    async isExpired(id: string): Promise<boolean> {
        const session = await this.findById(id);
        if (!session) {
            throw new NotFoundException(`PaymentSession with ID ${id} not found`);
        }

        return new Date() > session.expiresAt;
    }

    /**
     * PaymentSession이 특정 상태로 전환 가능한지 확인합니다.
     */
    async canTransitionTo(id: string, targetStatus: PaymentSessionStatus): Promise<boolean> {
        const session = await this.findById(id);
        if (!session) {
            return false;
        }

        try {
            this.validateStatusTransition(session.status as PaymentSessionStatus, targetStatus);
            return !this.isSessionExpired(session);
        } catch {
            return false;
        }
    }

    /**
     * 세션이 만료되었는지 확인하는 헬퍼 메서드
     */
    private isSessionExpired(session: PaymentSession): boolean {
        return new Date() > session.expiresAt;
    }
}