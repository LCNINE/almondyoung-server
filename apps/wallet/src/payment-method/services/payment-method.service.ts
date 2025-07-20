import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import * as schema from '../../shared/schemas/schema';
import { ulid } from 'ulid';
import { Method, BatchCms } from '../../shared/zod/payment-method.zod';
import { eq } from 'drizzle-orm';
import { EventProcessorService } from '../../shared/events/event-processor.service';
import {
  PaymentMethodCreatedEvent,
  PaymentMethodActivatedEvent,
  BatchCmsMethodRegisteredEvent,
} from '../events/payment-method.events';
import {
  METHOD_MANAGEMENT_PORT,
  MethodManagementPort,
} from '../../bnpl/ports/payment-ports';

/**
 * 결제수단(PaymentMethod) 도메인 서비스
 *
 * 역할
 * 1. 결제수단 생성 (초기 status=PENDING)
 * 2. 결제수단 정보 수정 (methodName, isDefault 등)
 * 3. 결제수단 비활성화/삭제 (소프트)
 */
@Injectable()
export class PaymentMethodService {
  private readonly logger = new Logger(PaymentMethodService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly eventProcessor: EventProcessorService,
    @Inject(METHOD_MANAGEMENT_PORT)
    private readonly methodManager: MethodManagementPort,
    // paymentMethodRepo 등 repository 관련 의존성 제거
  ) {}

  /**
   * 결제수단 신규 등록
   * - status 는 항상 PENDING 으로 시작
   * - BNPL인 경우 PG사 등록 요청 및 이벤트 발행
   * - isDefault=true 요청 시, 같은 userId 의 다른 isDefault 를 false 로 설정
   */
  async create(dto: Method['Create']) {
    return await this.dbService.db.transaction(async (tx) => {
      if (dto.isDefault) {
        // 동일 사용자 기존 기본 결제수단 해제
        await tx
          .update(schema.paymentMethod)
          .set({ isDefault: false })
          .where(eq(schema.paymentMethod.userId, dto.userId));
      }

      const [paymentMethod] = await tx
        .insert(schema.paymentMethod)
        .values({
          id: ulid(),
          userId: dto.userId,
          methodType: dto.methodType,
          methodName: dto.methodName,
          isDefault: dto.isDefault ?? false,
          institutionCode: dto.institutionCode,
          status: 'PENDING',
        })
        .returning();

      this.logger.log(`PaymentMethod created: ${paymentMethod.id}`);

      // 일반 결제수단 생성 이벤트 발행
      await this.eventProcessor.emit(
        new PaymentMethodCreatedEvent(
          paymentMethod.id,
          paymentMethod.userId,
          paymentMethod.methodType,
          paymentMethod.methodName,
          paymentMethod.institutionCode,
          paymentMethod.isDefault,
          {
            actor: 'USER',
            correlationId: ulid(),
          },
        ),
      );

      // BNPL인 경우 특별 처리
      if (dto.methodType === 'BNPL') {
        await this.handleBatchCmsRegistration(paymentMethod.id, dto);
      }

      return paymentMethod;
    });
  }

  /**
   * 결제수단 정보 수정
   */
  async update(
    id: string,
    updates: Partial<Omit<Method['Update'], 'userId' | 'methodType'>>,
  ) {
    if (!updates || Object.keys(updates).length === 0) {
      throw new BadRequestException('업데이트할 필드를 제공하세요.');
    }

    return await this.dbService.db.transaction(async (tx) => {
      const existing = await tx.query.paymentMethod.findFirst({
        where: eq(schema.paymentMethod.id, id),
      });

      if (!existing) {
        throw new NotFoundException('PaymentMethod not found');
      }

      // isDefault=true 로 바꾸려면 기존 기본값 해제
      if (updates.isDefault) {
        await tx
          .update(schema.paymentMethod)
          .set({ isDefault: false })
          .where(eq(schema.paymentMethod.userId, existing.userId));
      }

      const [updated] = await tx
        .update(schema.paymentMethod)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(schema.paymentMethod.id, id))
        .returning();

      this.logger.log(`PaymentMethod updated: ${updated.id}`);
      return updated;
    });
  }

  /**
   * 결제수단 비활성화 (Soft Delete)
   */
  async deactivate(id: string) {
    const [updated] = await this.dbService.db
      .update(schema.paymentMethod)
      .set({ status: 'INACTIVE', updatedAt: new Date() })
      .where(eq(schema.paymentMethod.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundException('PaymentMethod not found');
    }

    this.logger.log(`PaymentMethod deactivated: ${updated.id}`);
    return updated;
  }

  /**
   * 은행 인증 결과 콜백: status ACTIVE | FAILED 로 변경
   */
  async verifyStatus(id: string, status: 'ACTIVE' | 'FAILED') {
    if (!['ACTIVE', 'FAILED'].includes(status)) {
      throw new BadRequestException('status must be ACTIVE or FAILED');
    }

    const [updated] = await this.dbService.db
      .update(schema.paymentMethod)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.paymentMethod.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundException('PaymentMethod not found');
    }

    this.logger.log(`PaymentMethod verified (${status}): ${updated.id}`);
    return updated;
  }

  /**
   * BNPL 결제수단 등록 처리
   * - PG사(HMS)에 회원 등록 요청
   * - BatchCMS 테이블에 기록 (PENDING_APPROVAL 상태)
   * - BatchCmsMethodRegisteredEvent 발행
   */
  private async handleBatchCmsRegistration(
    paymentMethodId: string,
    dto: Method['Create'],
  ) {
    try {
      this.logger.log(`BNPL 등록 처리 시작: ${paymentMethodId}`);

      // TODO: 실제 PG사(HMS) 회원 등록 API 호출
      // const hmsResponse = await this.hmsApiService.registerMember({
      //   userId: dto.userId,
      //   creditLimit: creditLimit,
      //   approvedLimit: approvedLimit,
      //   billingCycleDay: billingCycleDay,
      // });

      // 임시로 목업 데이터 생성 (실제로는 HMS API 응답 사용)
      const hmsMemberId = `HMS_${ulid()}`;
      const hmsCustId = 'default-cust';

      // BNPL 기본값 설정 (실제로는 요청에서 받아야 함)
      const creditLimit = 1000000; // 기본 100만원
      const approvedLimit = creditLimit;
      const billingCycleDay = 1; // 매월 1일
      const termsUrl = undefined;

      // BatchCMS 테이블에 기록 (PENDING_APPROVAL 상태)
      const [batchCmsMethod] = await this.dbService.db
        .insert(schema.batchCmsMethod)
        .values({
          id: ulid(),
          paymentMethodId: paymentMethodId,
          // BatchCMS (HMS) 고유 필드
          hmsMemberId: hmsMemberId,
          hmsCustId: hmsCustId,
          // BNPL 관련 정보
          creditLimit: creditLimit,
          approvedLimit: approvedLimit,
          billingCycleDay: billingCycleDay,
          // BatchCMS 메타데이터
          hmsMetadata: undefined, // JSON 형태로 HMS 응답 원본 저장
          termsUrl: termsUrl,

          createdAt: new Date(),
          updatedAt: new Date(),
          status: 'PENDING',
        })
        .returning();

      this.logger.log(
        `BatchCMS 기록 생성: ${batchCmsMethod.id}, 상태: PENDING_APPROVAL`,
      );

      // BatchCmsMethodRegisteredEvent 발행 (BNPL 도메인에서 처리)
      await this.eventProcessor.emit(
        new BatchCmsMethodRegisteredEvent(
          paymentMethodId,
          dto.userId,
          hmsMemberId,
          hmsCustId,
          batchCmsMethod.creditLimit,
          batchCmsMethod.approvedLimit,
          batchCmsMethod.billingCycleDay,
          batchCmsMethod.termsUrl ?? undefined,
          {
            actor: 'SYSTEM',
            correlationId: ulid(),
          },
        ),
      );

      this.logger.log(`BNPL 등록 이벤트 발행 완료: ${paymentMethodId}`);
    } catch (error) {
      this.logger.error(`BNPL 등록 처리 실패: ${error}`, {
        paymentMethodId,
        userId: dto.userId,
        error: error as Error,
      });

      // PaymentMethod 상태를 FAILED로 변경
      await this.dbService.db
        .update(schema.paymentMethod)
        .set({ status: 'FAILED', updatedAt: new Date() })
        .where(eq(schema.paymentMethod.id, paymentMethodId));

      throw error;
    }
  }

  /**
   * PG사 승인 상태 확인 및 업데이트 (스케줄러에서 호출)
   * 매일 실행되어 PENDING_APPROVAL 상태인 BatchCMS 항목들을 확인
   */
  async checkAndUpdateBnplApprovalStatus() {
    this.logger.log('BNPL 승인 상태 확인 시작');

    try {
      // PENDING 상태인 PaymentMethod와 연결된 BatchCMS 항목들 조회
      const pendingMethods =
        await this.dbService.db.query.batchCmsMethod.findMany({
          with: {
            paymentMethod: true,
          },
        });

      // PaymentMethod 상태가 PENDING인 것들만 필터링
      const filteredPendingMethods = pendingMethods.filter(
        (item) => item.paymentMethod?.status === 'PENDING',
      );

      this.logger.log(
        `승인 대기 중인 BNPL 결제수단: ${filteredPendingMethods.length}개`,
      );

      for (const batchCmsMethod of filteredPendingMethods) {
        try {
          // TODO: 실제 PG사(HMS) 승인 상태 확인 API 호출
          // const approvalStatus = await this.hmsApiService.checkApprovalStatus(batchCmsMethod.hmsMemberId);

          // 임시로 3일 경과 여부로 승인 상태 결정
          const metadata = JSON.parse(batchCmsMethod.hmsMetadata || '{}') as {
            expectedApprovalDate: string;
          };
          const expectedApprovalDate = new Date(metadata.expectedApprovalDate);
          const isApproved = new Date() >= expectedApprovalDate;

          if (isApproved) {
            // 승인 완료 처리
            await this.approveBatchCmsMethod(batchCmsMethod);
          }
        } catch (error) {
          this.logger.error(
            `BNPL 승인 상태 확인 실패: ${batchCmsMethod.id}`,
            error,
          );
        }
      }
    } catch (error) {
      this.logger.error('BNPL 승인 상태 확인 중 오류 발생', error);
    }
  }

  /**
   * BNPL 결제수단 승인 처리
   */
  private async approveBatchCmsMethod(batchCmsMethod: BatchCms['Select']) {
    await this.dbService.db.transaction(async (tx) => {
      // BatchCMS 상태를 APPROVED로 변경
      await tx
        .update(schema.batchCmsMethod)
        .set({
          status: 'APPROVED',
          updatedAt: new Date(),
          hmsMetadata: JSON.stringify({
            ...(JSON.parse(batchCmsMethod.hmsMetadata || '{}') as {
              expectedApprovalDate: string;
            }),
            approvedDate: new Date().toISOString(),
          }),
        })
        .where(eq(schema.batchCmsMethod.id, batchCmsMethod.id));

      // PaymentMethod 상태를 ACTIVE로 변경
      await tx
        .update(schema.paymentMethod)
        .set({ status: 'ACTIVE', updatedAt: new Date() })
        .where(eq(schema.paymentMethod.id, batchCmsMethod.paymentMethodId));

      this.logger.log(
        `BNPL 결제수단 승인 완료: ${batchCmsMethod.paymentMethodId}`,
      );

      // PaymentMethodActivatedEvent 발행
      const paymentMethod = await tx.query.paymentMethod.findFirst({
        where: eq(schema.paymentMethod.id, batchCmsMethod.paymentMethodId),
      });

      if (paymentMethod) {
        await this.eventProcessor.emit(
          new PaymentMethodActivatedEvent(
            paymentMethod.id,
            paymentMethod.userId,
            paymentMethod.methodType,
            {
              actor: 'SYSTEM',
              correlationId: ulid(),
            },
          ),
        );
      }
    });
  }
}
