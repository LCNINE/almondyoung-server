import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../shared/schemas/schema';
import {
  PAYMENT_METHOD_STATUS,
  PAYMENT_SESSION_STATUS,
  FINANCIAL_TRANSACTION_STATUS,
} from '../shared/schemas/schema';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import {
  ProcessPaymentDto,
  PaymentDetailDto,
  AuthorizePaymentDto,
  CapturePaymentDto,
  PaymentMethodType,
} from './dto/process-payment.dto';
import { BnplAccountService } from '../bnpl/services/bnpl-account.service';
import { PointService } from '../point/point.service';
import { PaymentLockService } from '../payment-session/services/payment-lock.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  PaymentAuthorizedEvent,
  PaymentCapturedEvent,
} from './events/payment.events';
import {
  StandardSuccessResponse,
  PaymentAuthorizationResult,
  PaymentCaptureResult,
} from './types/payment-response.types';
import { WalletTx } from '../shared/types';

/**
 * 결제(Payment) 도메인 서비스 - 동기적 브릿지 패턴
 *
 * 이 서비스는 외부 시스템(Medusa)이 요구하는 즉각적인 동기 응답을 보장하기 위해
 * 모든 핵심 DB 작업을 단일 트랜잭션 내에서 동기적으로 처리합니다.
 *
 * 아키텍처 원칙:
 * 1. 동기적 코어: 결제 승인에 필요한 핵심 DB 작업을 트랜잭션 내에서 완료
 * 2. 즉각적 응답: 트랜잭션 커밋 후 즉시 응답 반환
 * 3. 명확한 상태 관리: Invoice는 실제 돈을 받은 후(CAPTURED)에만 PAID로 변경
 */

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly bnplAccountService: BnplAccountService,
    private readonly pointService: PointService,
    private readonly paymentLockService: PaymentLockService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 결제 승인 단계 (Authorization Phase)
   *
   * 모든 결제 수단의 승인을 처리합니다.
   * - BNPL: 내부 승인만 처리 (외부 PG 통신 없음)
   * - 즉시결제: 외부 PG사와 통신하여 승인
   *
   * @param payload 결제 승인에 필요한 정보
   * @returns 표준 응답 규격의 결제 승인 결과
   */
  async authorizePayment(
    payload: AuthorizePaymentDto,
  ): Promise<PaymentAuthorizationResult> {
    const { paymentSessionId, paymentMethodId, pointAmount, paymentMethods } =
      payload;

    this.logger.log(`[결제 승인] 시작: PaymentSession ${paymentSessionId}`);

    // ─────────────────────────────────────────
    // 🔧 새로운 3가지 결제 방식 처리
    // ─────────────────────────────────────────
    let paymentDetails: PaymentDetailDto[];

    if (paymentMethodId) {
      // 1️⃣ 단일 결제수단 (BNPL, 카드 등) - 90% 케이스
      paymentDetails = [
        {
          methodType: 'BNPL', // 기본값, 실제로는 paymentMethod 테이블에서 조회해야 함
          amount: 0, // 전액 결제, 나중에 invoice 금액으로 조정
          paymentMethodId: paymentMethodId,
        },
      ];
      this.logger.log(`[결제 승인] 단일 결제수단 사용: ${paymentMethodId}`);
    } else if (pointAmount) {
      // 2️⃣ 포인트 전용 결제
      paymentDetails = [
        {
          methodType: 'REWARD_POINT',
          amount: pointAmount,
        },
      ];
      this.logger.log(`[결제 승인] 포인트 전용 결제: ${pointAmount}P`);
    } else if (paymentMethods && paymentMethods.length > 0) {
      // 3️⃣ 혼합 결제 - 새로운 구조를 기존 구조로 변환
      paymentDetails = paymentMethods.map((pm) => ({
        methodType: pm.type === 'REWARD_POINT' ? 'REWARD_POINT' : 'BNPL', // 임시 매핑
        amount: pm.amount || 0,
        paymentMethodId: pm.paymentMethodId,
      }));
      this.logger.log(
        `[결제 승인] 혼합 결제: ${paymentMethods.length}개 결제수단`,
      );
    } else {
      // 이 경우는 DTO 검증에서 걸러져야 하지만 안전장치
      throw new BadRequestException(
        '결제수단을 선택해주세요. paymentMethodId, pointAmount, 또는 paymentMethods 중 하나를 지정하세요.',
      );
    }

    const result = await this.dbService.db.transaction(async (tx) => {
      // ─────────────────────────────────────────
      // Phase 1: 검증 단계
      // ─────────────────────────────────────────
      const paymentSession = await this.validatePaymentSession(
        tx,
        paymentSessionId,
      );

      // 🔧 invoiceSessionId는 내부적으로 자동 관리 (DTO에서 제거된 구현 세부사항)
      // 새로운 단순화된 구조에서는 세션 검증을 생략하고 바로 결제 처리
      this.logger.log(`[결제 승인] 세션 관리 생략 - 단순화된 플로우 사용`);

      const userId = paymentSession.userId;
      const sessionAmount = Number(paymentSession.amount);

      // 결제 금액 조정 및 검증
      paymentDetails = this.adjustPaymentAmounts(paymentDetails, sessionAmount);
      this.validatePaymentAmount(paymentDetails, sessionAmount);

      // ─────────────────────────────────────────
      // Phase 2: 결제 수단별 처리
      // ─────────────────────────────────────────
      const processedPayments: ProcessedPayment[] = [];
      const paymentEventIds: string[] = [];
      let primaryPaymentEventId = '';
      const shouldAutoCapture = false; // 즉시 캡처 여부

      for (const paymentDetail of paymentDetails) {
        const processedPayment = await this.processPaymentMethod(
          tx,
          paymentDetail,
          paymentSession,
          userId,
        );

        processedPayments.push(processedPayment);

        if (processedPayment.paymentEventId) {
          paymentEventIds.push(processedPayment.paymentEventId);
          if (!primaryPaymentEventId) {
            primaryPaymentEventId = processedPayment.paymentEventId;
          }
        }
      }

      return {
        paymentEventId: primaryPaymentEventId || ulid(),
        paymentEventIds,
        paymentStatus: 'AUTHORIZED',
        userId,
        paymentSession,
        processedPayments,
        totalAmount: sessionAmount,
        shouldAutoCapture,
      };
    });

    // 응답 준비
    const response = this.createAuthorizationResponse(result);

    // 세션 정리 및 이벤트 발행
    await this.handlePostAuthorization(result, paymentSessionId);

    // ─────────────────────────────────────────
    // 🎯 즉시결제의 경우 자동 캡처 실행
    // ─────────────────────────────────────────

    return response;
  }

  /**
   * 결제 수단별 처리 로직
   */
  private async processPaymentMethod(
    tx: WalletTx,
    paymentDetail: PaymentDetailDto,
    paymentSession: typeof schema.paymentSessions.$inferSelect,
    userId: string,
  ): Promise<ProcessedPayment> {
    if (paymentDetail.methodType === 'REWARD_POINT') {
      return this.processRewardPointPayment(
        tx,
        paymentDetail,
        userId,
        paymentSession.id,
      );
    } else if (paymentDetail.methodType === 'BNPL') {
      return this.processBnplPayment(
        tx,
        paymentDetail,
        userId,
        paymentSession.id,
      );
    } else if (this.isInstantPaymentMethod(paymentDetail.methodType)) {
      return this.processInstantPayment(
        tx,
        paymentDetail,
        userId,
        paymentSession.id,
      );
    } else {
      throw new BadRequestException(
        `지원하지 않는 결제 수단입니다: ${paymentDetail.methodType}`,
      );
    }
  }

  /**
   * 즉시결제 수단 여부 확인
   */
  private isInstantPaymentMethod(methodType: string): boolean {
    const instantMethods = ['CARD', 'TOSS_PAY', 'KAKAO_PAY', 'NAVER_PAY'];
    return instantMethods.includes(methodType);
  }

  /**
   * 즉시결제 처리 (카드, 간편결제 등)
   */
  private async processInstantPayment(
    tx: WalletTx,
    paymentDetail: PaymentDetailDto,
    userId: string,
    paymentSessionId: string,
  ): Promise<ProcessedPayment> {
    if (!paymentDetail.paymentMethodId) {
      throw new BadRequestException('결제수단 ID가 필요합니다.');
    }

    // 결제수단 검증
    const paymentMethod = await this.validatePaymentMethod(
      tx,
      paymentDetail.paymentMethodId,
    );

    // 외부 PG사에 승인 요청 (실제 구현 시)
    // const pgAuthResult = await this.pgService.authorize({
    //   paymentMethodId: paymentDetail.paymentMethodId,
    //   amount: paymentDetail.amount,
    //   invoiceId: invoiceId,
    // });

    // PaymentEvent 생성
    const paymentEventId = ulid();
    await tx.insert(schema.paymentEvents).values({
      id: paymentEventId,
      paymentMethodId: paymentDetail.paymentMethodId,
      paymentSessionId: paymentSessionId,
      amount: paymentDetail.amount,
      status: FINANCIAL_TRANSACTION_STATUS.AUTHORIZED,
      actor: 'USER',
      metadata: JSON.stringify({
        methodType: paymentDetail.methodType,
        timestamp: new Date().toISOString(),
        // pgAuthId: pgAuthResult.authorizationId,
      }),
      createdAt: new Date(),
    });

    this.logger.log(
      `[즉시결제] ${paymentDetail.methodType} 승인 완료: ${paymentDetail.amount}원`,
    );

    return {
      methodType: paymentDetail.methodType,
      amount: paymentDetail.amount,
      paymentMethodId: paymentDetail.paymentMethodId,
      paymentEventId,
      status: 'AUTHORIZED',
    };
  }

  /**
   * BNPL 결제 처리
   */
  private async processBnplPayment(
    tx: WalletTx,
    paymentDetail: PaymentDetailDto,
    userId: string,
    paymentSessionId: string,
  ): Promise<ProcessedPayment> {
    if (!paymentDetail.paymentMethodId) {
      throw new BadRequestException('BNPL 결제수단 ID가 필요합니다.');
    }

    // BNPL 검증 로직
    const paymentMethod = await this.validatePaymentMethod(
      tx,
      paymentDetail.paymentMethodId,
    );

    const bnplAccount = await this.validateBnplAccount(tx, userId);
    await this.validateBnplCreditLimit(userId, paymentDetail.amount);

    // PaymentEvent 생성
    const paymentEventId = ulid();
    await tx.insert(schema.paymentEvents).values({
      id: paymentEventId,
      paymentMethodId: paymentDetail.paymentMethodId,
      paymentSessionId: paymentSessionId,
      amount: paymentDetail.amount,
      status: FINANCIAL_TRANSACTION_STATUS.AUTHORIZED,
      actor: 'USER',
      metadata: JSON.stringify({
        methodType: 'BNPL',
        timestamp: new Date().toISOString(),
      }),
      createdAt: new Date(),
    });

    // BnplTransaction 생성
    await tx.insert(schema.bnplTransaction).values({
      id: ulid(),
      bnplAccountId: bnplAccount.id,
      paymentSessionId: paymentSessionId,
      transactionType: 'DEBIT',
      status: FINANCIAL_TRANSACTION_STATUS.AUTHORIZED,
      amount: paymentDetail.amount,
      createdAt: new Date(),
    });

    this.logger.log(`[BNPL] 내부 승인 완료: ${paymentDetail.amount}원`);

    return {
      methodType: 'BNPL',
      amount: paymentDetail.amount,
      paymentMethodId: paymentDetail.paymentMethodId,
      paymentEventId,
      status: 'AUTHORIZED',
    };
  }

  /**
   * 포인트 결제 처리
   */
  private async processRewardPointPayment(
    tx: WalletTx,
    paymentDetail: PaymentDetailDto,
    userId: string,
    paymentSessionId: string,
  ): Promise<ProcessedPayment> {
    this.logger.log(`[포인트] 사용: ${paymentDetail.amount} 포인트`);

    const pointResult = await this.pointService.redeemPoints({
      userId,
      amount: paymentDetail.amount,
      reason: `결제 세션 ${paymentSessionId} 결제`,
      relatedEventId: paymentSessionId,
    });

    if (!pointResult.success) {
      throw new BadRequestException(`포인트 사용 실패: ${pointResult.message}`);
    }

    return {
      methodType: 'REWARD_POINT',
      amount: paymentDetail.amount,
      status: 'CAPTURED', // 포인트는 즉시 차감
    };
  }

  /**
   * 결제 캡처 - 정산 완료 처리
   *
   * 이 메서드는 두 가지 시나리오에서 사용됩니다:
   * 1. 즉시 결제 (토스 등): 외부 PG사에서 실시간 캡처 요청
   * 2. BNPL 정산 완료: SettlementService에서 실제 출금 확인 후 호출
   *
   * CAPTURED 상태는 "실제로 돈을 받았다"는 의미입니다.
   *
   * @param payload 결제 캡처에 필요한 정보
   * @returns 표준 응답 규격의 결제 캡처 결과
   */
  async capturePayment(
    payload: CapturePaymentDto,
  ): Promise<PaymentCaptureResult> {
    const { paymentEventId, amount, pgTransactionId } = payload;

    this.logger.log(`[결제 캡처] 시작: PaymentEvent ${paymentEventId}`);

    const result = await this.dbService.db.transaction(async (tx) => {
      // ─────────────────────────────────────────
      // 1. 결제 이벤트 조회 및 검증
      // ─────────────────────────────────────────
      const paymentEvent = await tx.query.paymentEvents.findFirst({
        where: eq(schema.paymentEvents.id, paymentEventId),
        with: {
          paymentMethod: true,
          paymentSession: true,
        },
      });

      if (!paymentEvent) {
        throw new NotFoundException('존재하지 않는 결제 이벤트입니다.');
      }

      // 캡처 가능한 상태 검증
      const capturableStatuses =
        FINANCIAL_TRANSACTION_STATUS.AUTHORIZED ||
        FINANCIAL_TRANSACTION_STATUS.SETTLEMENT_REQUESTED;

      if (capturableStatuses !== paymentEvent.status) {
        throw new BadRequestException(
          `캡처할 수 없는 결제 상태입니다: ${paymentEvent.status}`,
        );
      }

      // 캡처 금액 검증
      const captureAmount = amount || Number(paymentEvent.amount);
      if (captureAmount > Number(paymentEvent.amount)) {
        throw new BadRequestException(
          '캡처 금액이 승인 금액을 초과할 수 없습니다.',
        );
      }

      // ─────────────────────────────────────────
      // 2. 결제 수단별 캡처 처리
      // ─────────────────────────────────────────
      const paymentMethod = paymentEvent.paymentMethod;
      const methodType = paymentMethod?.methodType || 'UNKNOWN';

      this.logger.log(
        `[결제 캡처] ${methodType} 결제 캡처 처리: ${captureAmount}원`,
      );

      // PaymentEvent를 CAPTURED로 업데이트
      await tx
        .update(schema.paymentEvents)
        .set({
          status: FINANCIAL_TRANSACTION_STATUS.CAPTURED,
          pgTransactionId: pgTransactionId || paymentEvent.pgTransactionId,
          updatedAt: new Date(),
        })
        .where(eq(schema.paymentEvents.id, paymentEventId));

      // BNPL인 경우 BnplTransaction도 업데이트
      if (methodType === 'BNPL') {
        await tx
          .update(schema.bnplTransaction)
          .set({
            status: FINANCIAL_TRANSACTION_STATUS.CAPTURED,
          })
          .where(
            eq(
              schema.bnplTransaction.paymentSessionId,
              paymentEvent.paymentSessionId,
            ),
          );

        this.logger.log(
          `[결제 캡처] BNPL 거래 상태 업데이트 완료: PaymentSession ${paymentEvent.paymentSessionId}`,
        );
      }

      // ─────────────────────────────────────────
      // 3. PaymentSession을 CAPTURED로 업데이트
      // ─────────────────────────────────────────
      await tx
        .update(schema.paymentSessions)
        .set({
          status: PAYMENT_SESSION_STATUS.CAPTURED,
          capturedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.paymentSessions.id, paymentEvent.paymentSessionId));

      this.logger.log(
        `[결제 캡처] PaymentSession ${paymentEvent.paymentSessionId} → CAPTURED 상태 변경 완료`,
      );

      return {
        paymentEventId,
        paymentSessionId: paymentEvent.paymentSessionId,
        userId: paymentEvent.paymentSession.userId,
        paymentStatus: FINANCIAL_TRANSACTION_STATUS.CAPTURED,
        capturedAmount: captureAmount,
        paymentMethod: methodType,
      };
    });

    // ─────────────────────────────────────────
    // 4. 이벤트 발행 (부가적인 후속 조치용)
    // ─────────────────────────────────────────
    // Payment 캡처 완료 이벤트
    this.eventEmitter.emit(
      'payment.captured',
      new PaymentCapturedEvent(
        result.paymentEventId,
        result.paymentSessionId,
        result.capturedAmount,
        pgTransactionId,
        new Date(),
      ),
    );

    // PaymentSession 결제 완료 이벤트
    this.eventEmitter.emit('payment-session.captured', {
      paymentSessionId: result.paymentSessionId,
      paymentEventId: result.paymentEventId,
      capturedAmount: result.capturedAmount,
      capturedAt: new Date(),
    });

    // 포인트 적립 등을 위한 결제 완료 이벤트
    this.eventEmitter.emit('payment.completed', {
      paymentEventId: result.paymentEventId,
      userId: result.userId,
      amount: result.capturedAmount,
      paymentSessionId: result.paymentSessionId,
      paymentMethod: result.paymentMethod,
      completedAt: new Date(),
    });

    this.logger.log(
      `[결제 캡처] 완료: ${result.paymentEventId} (${result.paymentMethod})`,
    );

    // 표준 응답 반환
    return {
      entityId: result.paymentEventId,
      timestamp: new Date().toISOString(),
      entityType: 'payments',
      entityBody: {
        paymentEventId: result.paymentEventId,
        paymentStatus: result.paymentStatus,
        capturedAmount: result.capturedAmount,
      },
    };
  }

  /**
   * 하위 호환성을 위한 기존 processPayment 메서드
   * 내부적으로는 authorize + capture 패턴을 사용
   */
  async processPayment(payload: ProcessPaymentDto): Promise<
    StandardSuccessResponse<{
      paymentEventId: string;
      paymentStatus: string;
      totalAmount: number;
    }>
  > {
    this.logger.log(
      '[하위 호환성] processPayment 호출 → 새로운 AuthorizePaymentDto로 변환',
    );

    // ─────────────────────────────────────────
    // 🔄 하위 호환성 어댑터: 기존 DTO → 새로운 DTO 변환
    // ─────────────────────────────────────────
    const authorizePayload = this.convertToAuthorizePaymentDto(payload);

    // 1. 승인 단계 실행
    const authResult = await this.authorizePayment(authorizePayload);

    // 2. 즉시 캡처 실행 (기존 동작 유지)
    const captureResult = await this.capturePayment({
      paymentEventId: authResult.entityId,
    });

    // 3. 표준 응답 규격에 맞게 반환
    return {
      entityId: captureResult.entityId,
      timestamp: new Date().toISOString(),
      entityType: 'payments',
      entityBody: {
        paymentEventId: captureResult.entityId,
        paymentStatus: captureResult.entityBody.paymentStatus,
        totalAmount: authResult.entityBody.totalAmount,
      },
    };
  }

  /**
   * 🔄 하위 호환성 어댑터: ProcessPaymentDto → AuthorizePaymentDto 변환
   */
  private convertToAuthorizePaymentDto(
    payload: ProcessPaymentDto,
  ): AuthorizePaymentDto {
    this.logger.log('[어댑터] 기존 DTO를 새로운 구조로 변환 중...');

    // 기본 구조
    const result: AuthorizePaymentDto = {
      paymentSessionId: payload.paymentSessionId,
    };

    // 1. 단일 결제수단 방식 (paymentMethodId 우선)
    if (payload.paymentMethodId) {
      result.paymentMethodId = payload.paymentMethodId;
      this.logger.log(
        `[어댑터] 단일 결제수단 변환: ${payload.paymentMethodId}`,
      );
      return result;
    }

    // 2. payments 배열 방식
    if (payload.payments && payload.payments.length > 0) {
      // 포인트 전용 결제 확인
      if (
        payload.payments.length === 1 &&
        payload.payments[0].methodType === 'REWARD_POINT'
      ) {
        result.pointAmount = payload.payments[0].amount;
        this.logger.log(
          `[어댑터] 포인트 전용 결제 변환: ${payload.payments[0].amount}P`,
        );
        return result;
      }

      // 혼합 결제 또는 복잡한 케이스
      result.paymentMethods = payload.payments.map((payment) => ({
        type: this.mapMethodTypeToNewFormat(payment.methodType),
        paymentMethodId: payment.paymentMethodId,
        amount: payment.amount > 0 ? payment.amount : undefined,
      }));
      this.logger.log(
        `[어댑터] 혼합 결제 변환: ${payload.payments.length}개 결제수단`,
      );
      return result;
    }

    throw new BadRequestException(
      '결제 정보가 필요합니다. paymentMethodId 또는 payments 배열을 지정하세요.',
    );
  }

  /**
   * 기존 methodType을 새로운 PaymentMethodType으로 매핑
   */
  private mapMethodTypeToNewFormat(
    oldType:
      | 'BNPL'
      | 'REWARD_POINT'
      | 'CARD'
      | 'TOSS_PAY'
      | 'KAKAO_PAY'
      | 'NAVER_PAY',
  ): PaymentMethodType {
    switch (oldType) {
      case 'BNPL':
        return 'BNPL';
      case 'REWARD_POINT':
        return 'REWARD_POINT';
      case 'CARD':
      case 'TOSS_PAY':
      case 'KAKAO_PAY':
      case 'NAVER_PAY':
        return 'CARD'; // 모든 카드/간편결제를 CARD로 통합
      default:
        throw new BadRequestException('지원하지 않는 결제수단입니다.');
    }
  }

  /**
   * 헬퍼 메서드들
   */
  private async validatePaymentSession(tx: WalletTx, paymentSessionId: string) {
    const paymentSession = await tx.query.paymentSessions.findFirst({
      where: eq(schema.paymentSessions.id, paymentSessionId),
    });

    if (!paymentSession) {
      throw new NotFoundException('존재하지 않는 결제 세션입니다.');
    }

    if (paymentSession.status === PAYMENT_SESSION_STATUS.CANCELLED) {
      throw new BadRequestException('취소된 결제 세션입니다.');
    }

    if (paymentSession.status === PAYMENT_SESSION_STATUS.FAILED) {
      throw new BadRequestException('이전에 결제 실패한 세션입니다.');
    }

    if (paymentSession.status === PAYMENT_SESSION_STATUS.CAPTURED) {
      throw new BadRequestException('이미 결제 완료된 세션입니다.');
    }

    return paymentSession;
  }

  private adjustPaymentAmounts(
    paymentDetails: PaymentDetailDto[],
    sessionAmount: number,
  ): PaymentDetailDto[] {
    // 하위 호환성: 기존 단일 결제 방식에서 전액 설정
    if (paymentDetails.length === 1 && paymentDetails[0].amount === 0) {
      paymentDetails[0].amount = sessionAmount;
    }
    return paymentDetails;
  }

  private validatePaymentAmount(
    paymentDetails: PaymentDetailDto[],
    sessionAmount: number,
  ): void {
    const totalPaymentAmount = paymentDetails.reduce(
      (sum, payment) => sum + payment.amount,
      0,
    );

    if (totalPaymentAmount !== sessionAmount) {
      throw new BadRequestException(
        `결제 금액이 결제 세션 금액과 일치하지 않습니다. (세션: ${sessionAmount}원, 결제: ${totalPaymentAmount}원)`,
      );
    }
  }

  private async validatePaymentMethod(tx: WalletTx, paymentMethodId: string) {
    const paymentMethod = await tx.query.paymentMethod.findFirst({
      where: eq(schema.paymentMethod.id, paymentMethodId),
      with: {
        batchCms: true,
        card: true,
      },
    });

    if (!paymentMethod) {
      throw new NotFoundException('존재하지 않는 결제수단입니다.');
    }

    if (paymentMethod.status !== PAYMENT_METHOD_STATUS.ACTIVE) {
      throw new BadRequestException('활성화된 결제수단이 아닙니다.');
    }

    return paymentMethod;
  }

  private async validateBnplAccount(tx: WalletTx, userId: string) {
    const bnplAccount = await tx.query.bnplAccount.findFirst({
      where: eq(schema.bnplAccount.userId, userId),
    });

    if (!bnplAccount) {
      throw new NotFoundException('BNPL 계정이 존재하지 않습니다.');
    }

    return bnplAccount;
  }

  private async validateBnplCreditLimit(userId: string, amount: number) {
    const availableCredit =
      await this.bnplAccountService.getAvailableCredit(userId);
    if (amount > availableCredit) {
      this.logger.warn(
        `[BNPL] 신용 한도 초과: 사용자 ${userId}, 요청 ${amount}, 사용가능 ${availableCredit}`,
      );
      throw new BadRequestException(
        `BNPL 신용 한도를 초과했습니다. (사용 가능액: ${availableCredit}원)`,
      );
    }
  }

  private createAuthorizationResponse(result: any): PaymentAuthorizationResult {
    return {
      entityId: result.paymentEventId,
      timestamp: new Date().toISOString(),
      entityType: 'payments',
      entityBody: {
        paymentEventId: result.paymentEventId,
        paymentStatus: result.paymentStatus,
        userId: result.userId,
        processedPayments: result.processedPayments,
        totalAmount: result.totalAmount,
      },
    };
  }

  private async handlePostAuthorization(result: any, paymentSessionId: string) {
    // 결제 잠금 정리 (필요시)
    // await this.paymentLockService.clearPaymentLock(paymentSessionId);

    // 결제 수단별 이벤트 발행
    for (const payment of result.processedPayments) {
      if (payment.paymentEventId) {
        this.eventEmitter.emit(
          'payment.authorized',
          new PaymentAuthorizedEvent(
            payment.paymentEventId,
            paymentSessionId,
            payment.paymentMethodId!,
            payment.amount,
            result.userId,
            new Date(),
          ),
        );
      }
    }
  }

  /**
   * 다음 정산일(출금일)을 계산하는 헬퍼 메서드
   */
  private calculateNextPaymentDate(): string {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 15);
    const year = nextMonth.getFullYear();
    const month = (nextMonth.getMonth() + 1).toString().padStart(2, '0');
    const day = nextMonth.getDate().toString().padStart(2, '0');
    return `${year}${month}${day}`;
  }
}

// 타입 정의 (별도 파일로 분리 권장)
interface ProcessedPayment {
  methodType: string;
  amount: number;
  paymentMethodId?: string;
  paymentEventId?: string;
  status: string;
}
