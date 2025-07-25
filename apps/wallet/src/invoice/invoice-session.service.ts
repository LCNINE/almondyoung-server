import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../shared/schemas/schema';
import { eq, sql, and, lt } from 'drizzle-orm';
import { ulid } from 'ulid';
import { Cron, CronExpression } from '@nestjs/schedule';

export interface InvoiceSessionResult {
  invoiceSessionId: string;
  expiresAt: Date;
}

/**
 * 청구서 세션 관리 서비스
 * - Invoice 단위 동시성 제어를 통한 중복 결제 방지
 * - 비관적 잠금(Pessimistic Lock)을 사용한 안전한 세션 생성
 */
@Injectable()
export class InvoiceSessionService {
  private readonly logger = new Logger(InvoiceSessionService.name);
  private readonly SESSION_DURATION_MINUTES = 15; // 15분 세션 유지

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {}

  /**
   * 특정 청구서에 대한 결제 세션을 생성합니다.
   * 동시성 제어를 위해 비관적 잠금을 사용합니다.
   *
   * @param invoiceId 청구서 ID
   * @param userId 사용자 ID
   * @returns 생성된 청구서 세션 정보
   * @throws ConflictException 이미 유효한 세션이 있거나 결제 불가능한 상태인 경우
   * @throws NotFoundException 청구서를 찾을 수 없는 경우
   */
  async createInvoiceSession(
    invoiceId: string,
    userId: string,
  ): Promise<InvoiceSessionResult> {
    this.logger.log(`청구서 세션 생성 시작: Invoice ${invoiceId} - ${userId}`);

    return await this.dbService.db.transaction(async (tx) => {
      // 1. 비관적 잠금으로 Invoice 조회 (다른 트랜잭션의 동시 접근 차단)
      const [invoice] = await tx
        .select()
        .from(schema.invoice)
        .where(eq(schema.invoice.id, invoiceId))
        .for('update');

      if (!invoice) {
        throw new NotFoundException(`청구서를 찾을 수 없습니다: ${invoiceId}`);
      }

      // 2. 사용자 권한 확인
      if (invoice.userId !== userId) {
        throw new BadRequestException('해당 청구서에 대한 권한이 없습니다.');
      }

      // 3. 청구서 상태 검증 (결제 가능한 상태인지 확인)
      const isPayableStatus =
        invoice.status === schema.INVOICE_STATUS.ISSUED ||
        invoice.status === schema.INVOICE_STATUS.FAILED;

      if (!isPayableStatus) {
        throw new ConflictException(
          `결제할 수 없는 청구서 상태입니다: ${invoice.status}. 결제 가능한 상태: ${schema.INVOICE_STATUS.ISSUED}, ${schema.INVOICE_STATUS.FAILED}`,
        );
      }

      // 4. 기존 유효한 세션 확인
      const now = new Date();
      if (
        invoice.invoiceSessionId &&
        invoice.invoiceSessionExpiresAt &&
        invoice.invoiceSessionExpiresAt > now
      ) {
        this.logger.warn(
          `이미 유효한 청구서 세션이 존재합니다: ${invoice.invoiceSessionId}`,
        );
        throw new ConflictException(
          '다른 기기에서 이미 결제를 진행 중입니다. 잠시 후 다시 시도해주세요.',
        );
      }

      // 5. 새로운 세션 생성
      const sessionId = `sess_${ulid()}`;
      const expiresAt = new Date(
        now.getTime() + this.SESSION_DURATION_MINUTES * 60 * 1000,
      );

      // 6. Invoice 테이블에 세션 정보 업데이트
      await tx
        .update(schema.invoice)
        .set({
          invoiceSessionId: sessionId,
          invoiceSessionExpiresAt: expiresAt,
          updatedAt: now,
        })
        .where(eq(schema.invoice.id, invoiceId));

      this.logger.log(
        `청구서 세션 생성 완료: ${sessionId} (만료: ${expiresAt.toISOString()})`,
      );

      return {
        invoiceSessionId: sessionId,
        expiresAt,
      };
    });
  }

  /**
   * 청구서 세션의 유효성을 검증합니다.
   *
   * @param invoiceId 청구서 ID
   * @param invoiceSessionId 검증할 세션 ID
   * @returns 세션이 유효한지 여부
   * @throws BadRequestException 세션이 유효하지 않은 경우
   */
  async validateInvoiceSession(
    invoiceId: string,
    invoiceSessionId: string,
  ): Promise<boolean> {
    this.logger.log(
      `청구서 세션 검증: Invoice ${invoiceId}, Session ${invoiceSessionId}`,
    );

    const invoice = await this.dbService.db.query.invoice.findFirst({
      where: eq(schema.invoice.id, invoiceId),
      columns: {
        invoiceSessionId: true,
        invoiceSessionExpiresAt: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException(`청구서를 찾을 수 없습니다: ${invoiceId}`);
    }

    // 세션 ID 일치 확인
    if (invoice.invoiceSessionId !== invoiceSessionId) {
      this.logger.warn(
        `세션 ID 불일치: 요청=${invoiceSessionId}, DB=${invoice.invoiceSessionId}`,
      );
      throw new BadRequestException('유효하지 않은 청구서 세션입니다.');
    }

    // 세션 만료 확인
    const now = new Date();
    if (
      !invoice.invoiceSessionExpiresAt ||
      invoice.invoiceSessionExpiresAt <= now
    ) {
      this.logger.warn(`만료된 청구서 세션: ${invoiceSessionId}`);
      throw new BadRequestException(
        '청구서 세션이 만료되었습니다. 새로운 세션을 생성해주세요.',
      );
    }

    this.logger.log(`청구서 세션 검증 성공: ${invoiceSessionId}`);
    return true;
  }

  /**
   * 결제 완료 후 세션을 정리합니다.
   *
   * @param invoiceId 청구서 ID
   */
  async clearInvoiceSession(invoiceId: string): Promise<void> {
    this.logger.log(`청구서 세션 정리: Invoice ${invoiceId}`);

    await this.dbService.db
      .update(schema.invoice)
      .set({
        invoiceSessionId: null,
        invoiceSessionExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.invoice.id, invoiceId));

    this.logger.log(`청구서 세션 정리 완료: Invoice ${invoiceId}`);
  }

  /**
   * 만료된 청구서 세션들을 정리합니다.
   * 매 5분마다 실행되는 스케줄러입니다.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async cleanupExpiredSessions(): Promise<void> {
    this.logger.log('만료된 청구서 세션 정리 시작');

    try {
      const now = new Date();
      const result = await this.dbService.db
        .update(schema.invoice)
        .set({
          invoiceSessionId: null,
          invoiceSessionExpiresAt: null,
          updatedAt: now,
        })
        .where(
          and(
            lt(schema.invoice.invoiceSessionExpiresAt, now),
            sql`${schema.invoice.invoiceSessionId} IS NOT NULL`,
          ),
        );

      this.logger.log(`만료된 청구서 세션 정리 완료`);
    } catch (error) {
      this.logger.error('만료된 청구서 세션 정리 중 오류 발생', error);
    }
  }
}
