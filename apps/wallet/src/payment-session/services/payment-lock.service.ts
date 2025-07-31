import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../../shared/schemas/schema';
import { eq, and, lt } from 'drizzle-orm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes } from 'crypto';
import {
  CreatePaymentLockDto,
  ValidatePaymentLockDto,
} from '../dto';
import {
  PaymentLock,
  PaymentLockInsert,
} from '../types';

@Injectable()
export class PaymentLockService {
  private readonly logger = new Logger(PaymentLockService.name);
  private readonly DEFAULT_LOCK_DURATION_MINUTES = 15;

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly eventEmitter: EventEmitter2,
  ) { }

  /**
   * PaymentSession에 대한 결제 잠금을 생성합니다.
   * 동시성 제어를 위해 비관적 잠금을 사용합니다.
   */
  async createLock(dto: CreatePaymentLockDto): Promise<PaymentLock> {
    const { paymentSessionId, deviceFingerprint, userAgent, ipAddress, expiresInMinutes } = dto;

    this.logger.log(`Creating payment lock for session: ${paymentSessionId}`);

    return await this.dbService.db.transaction(async (tx) => {
      // 1. PaymentSession 존재 여부 및 상태 확인 (비관적 잠금)
      const [paymentSession] = await tx
        .select()
        .from(schema.paymentSessions)
        .where(eq(schema.paymentSessions.id, paymentSessionId))
        .for('update');

      if (!paymentSession) {
        throw new NotFoundException(`PaymentSession not found: ${paymentSessionId}`);
      }

      // 2. PaymentSession 상태 검증 (결제 가능한 상태인지 확인)
      if (paymentSession.status !== 'PENDING') {
        throw new ConflictException(
          `Cannot create lock for PaymentSession in status: ${paymentSession.status}`,
        );
      }

      // 3. PaymentSession 만료 확인
      const now = new Date();
      if (paymentSession.expiresAt <= now) {
        throw new ConflictException('PaymentSession has expired');
      }

      // 4. 기존 활성 잠금 확인
      const existingLock = await tx.query.paymentLocks.findFirst({
        where: and(
          eq(schema.paymentLocks.paymentSessionId, paymentSessionId),
          eq(schema.paymentLocks.status, 'ACTIVE'),
        ),
      });

      if (existingLock && existingLock.expiresAt > now) {
        this.logger.warn(`Active lock already exists: ${existingLock.lockToken}`);
        throw new ConflictException(
          'Another payment is already in progress. Please try again later.',
        );
      }

      // 5. 만료된 기존 잠금이 있다면 상태 업데이트
      if (existingLock && existingLock.expiresAt <= now) {
        await tx
          .update(schema.paymentLocks)
          .set({ status: 'EXPIRED' })
          .where(eq(schema.paymentLocks.id, existingLock.id));
      }

      // 6. 새로운 잠금 생성
      const lockToken = this.generateSecureToken();
      const expiresAt = new Date(
        now.getTime() + (expiresInMinutes || this.DEFAULT_LOCK_DURATION_MINUTES) * 60 * 1000,
      );

      const insertData: PaymentLockInsert = {
        paymentSessionId,
        lockToken,
        deviceFingerprint,
        userAgent,
        ipAddress,
        status: 'ACTIVE',
        expiresAt,
        createdAt: now,
      };

      const [newLock] = await tx
        .insert(schema.paymentLocks)
        .values(insertData)
        .returning();

      // 7. 잠금 생성 이벤트 발행
      this.eventEmitter.emit('payment-lock.created', {
        paymentSessionId,
        lockId: newLock.id,
        lockToken,
        expiresAt,
        createdAt: now,
      });

      this.logger.log(
        `Payment lock created: ${lockToken} (expires: ${expiresAt.toISOString()})`,
      );

      return newLock;
    });
  }

  /**
   * 결제 잠금의 유효성을 검증합니다.
   */
  async validateLock(dto: ValidatePaymentLockDto): Promise<PaymentLock> {
    const { lockToken } = dto;

    this.logger.log(`Validating payment lock: ${lockToken}`);

    const lock = await this.dbService.db.query.paymentLocks.findFirst({
      where: eq(schema.paymentLocks.lockToken, lockToken),
    });

    if (!lock) {
      throw new NotFoundException('Payment lock not found');
    }

    // 잠금 상태 확인
    if (lock.status !== 'ACTIVE') {
      throw new BadRequestException(`Payment lock is not active: ${lock.status}`);
    }

    // 잠금 만료 확인
    const now = new Date();
    if (lock.expiresAt <= now) {
      // 만료된 잠금 상태 업데이트
      await this.expireLock(lock.id);
      throw new BadRequestException('Payment lock has expired');
    }

    this.logger.log(`Payment lock validation successful: ${lockToken}`);
    return lock;
  }

  /**
   * PaymentSession에 대한 활성 잠금을 조회합니다.
   */
  async findActiveLock(paymentSessionId: string): Promise<PaymentLock | null> {
    const now = new Date();

    const lock = await this.dbService.db.query.paymentLocks.findFirst({
      where: and(
        eq(schema.paymentLocks.paymentSessionId, paymentSessionId),
        eq(schema.paymentLocks.status, 'ACTIVE'),
      ),
    });

    // lock이 undefined인 경우 null 반환
    if (!lock) {
      return null;
    }

    // 잠금이 있지만 만료된 경우 상태 업데이트
    if (lock.expiresAt <= now) {
      await this.expireLock(lock.id);
      return null;
    }

    return lock;
  }
  /**
   * 잠금을 만료 상태로 변경합니다.
   */
  async expireLock(id: string): Promise<void> {
    this.logger.log(`Expiring payment lock: ${id}`);

    await this.dbService.db
      .update(schema.paymentLocks)
      .set({ status: 'EXPIRED' })
      .where(eq(schema.paymentLocks.id, id));

    // 잠금 만료 이벤트 발행
    this.eventEmitter.emit('payment-lock.expired', {
      lockId: id,
      expiredAt: new Date(),
    });
  }

  /**
   * 잠금을 완료 상태로 변경합니다.
   */
  async completeLock(id: string): Promise<void> {
    this.logger.log(`Completing payment lock: ${id}`);

    await this.dbService.db
      .update(schema.paymentLocks)
      .set({ status: 'COMPLETED' })
      .where(eq(schema.paymentLocks.id, id));

    // 잠금 완료 이벤트 발행
    this.eventEmitter.emit('payment-lock.completed', {
      lockId: id,
      completedAt: new Date(),
    });
  }

  /**
   * 토큰으로 잠금을 완료 상태로 변경합니다.
   */
  async completeLockByToken(lockToken: string): Promise<void> {
    const lock = await this.validateLock({ lockToken });
    await this.completeLock(lock.id);
  }

  /**
   * 만료된 결제 잠금들을 정리합니다.
   * 매 5분마다 실행되는 스케줄러입니다.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async cleanupExpiredLocks(): Promise<void> {
    this.logger.log('Starting expired payment locks cleanup');

    try {
      const now = new Date();

      // 만료된 활성 잠금들을 찾아서 상태 업데이트
      const expiredLocks = await this.dbService.db.query.paymentLocks.findMany({
        where: and(
          eq(schema.paymentLocks.status, 'ACTIVE'),
          lt(schema.paymentLocks.expiresAt, now),
        ),
        columns: { id: true, lockToken: true },
      });

      if (expiredLocks.length > 0) {
        await this.dbService.db
          .update(schema.paymentLocks)
          .set({ status: 'EXPIRED' })
          .where(
            and(
              eq(schema.paymentLocks.status, 'ACTIVE'),
              lt(schema.paymentLocks.expiresAt, now),
            ),
          );

        // 만료 이벤트 발행
        expiredLocks.forEach(lock => {
          this.eventEmitter.emit('payment-lock.expired', {
            lockId: lock.id,
            expiredAt: now,
          });
        });

        this.logger.log(`Cleaned up ${expiredLocks.length} expired payment locks`);
      }
    } catch (error) {
      this.logger.error('Error during payment locks cleanup', error);
    }
  }

  /**
   * 보안 토큰을 생성합니다.
   */
  private generateSecureToken(): string {
    // 128자리 보안 토큰 생성 (64바이트를 hex로 인코딩)
    return randomBytes(64).toString('hex');
  }

  /**
   * 잠금이 만료되었는지 확인합니다.
   */
  async isLockExpired(lockToken: string): Promise<boolean> {
    const lock = await this.dbService.db.query.paymentLocks.findFirst({
      where: eq(schema.paymentLocks.lockToken, lockToken),
      columns: { expiresAt: true },
    });

    if (!lock) {
      return true; // 존재하지 않는 잠금은 만료된 것으로 간주
    }

    return new Date() > lock.expiresAt;
  }

  /**
   * 잠금의 남은 시간을 분 단위로 반환합니다.
   */
  async getRemainingMinutes(lockToken: string): Promise<number> {
    const lock = await this.dbService.db.query.paymentLocks.findFirst({
      where: eq(schema.paymentLocks.lockToken, lockToken),
      columns: { expiresAt: true },
    });

    if (!lock) {
      return 0;
    }

    const now = new Date();
    const diff = lock.expiresAt.getTime() - now.getTime();
    return Math.max(0, Math.floor(diff / (1000 * 60)));
  }
}