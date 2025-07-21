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
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BnplPaymentMethodRegisteredEvent } from '../events/bnpl-payment-method-registered.event';
import { MethodManagementPort } from '../port/method-management.port';
import { RegisterAgreementRequest } from 'hms-api-wrapper';

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
    @Inject(MethodManagementPort)
    private readonly methodManager: MethodManagementPort,
    private readonly eventEmitter: EventEmitter2,
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
        await tx
          .update(schema.paymentMethod)
          .set({ isDefault: false })
          .where(eq(schema.paymentMethod.userId, dto.userId));
      }

      // 1. 공통 paymentMethod를 먼저 PENDING 상태로 생성합니다.
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

      // 2. BNPL인 경우, Port를 통해 등록 절차를 '위임'합니다.
      //    이 서비스는 어댑터가 내부적으로 DB를 쓰는지 API만 쓰는지 더 이상 신경쓰지 않습니다.
      if (dto.methodType === 'BNPL') {
        try {
          // 어댑터가 트랜잭션에 참여하도록 tx와 paymentMethod 정보를 전달합니다.
          await this.methodManager.registerMember(dto, tx, paymentMethod);
        } catch (error) {
          this.logger.error(`BNPL 등록 위임 실패: ${paymentMethod.id}`, error);
          // 어댑터에서 발생한 에러를 여기서 잡아서 최종 처리
          // 트랜잭션이 롤백되도록 에러를 다시 던집니다.
          throw error;
        }
        // 트랜잭션 성공 후 이벤트 발행
        this.eventEmitter.emit(
          'bnpl.method.registered',
          new BnplPaymentMethodRegisteredEvent(
            paymentMethod.id,
            paymentMethod.userId,
            1000000, // 예시: 실제 한도 정보로 교체 가능
            1000000,
            1,
          ),
        );
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

  async submitConsent(dto: RegisterAgreementRequest) {
    return await this.methodManager.submitConsent(dto);
  }

  /**
   * PG사 승인 상태 확인 및 업데이트 (스케줄러에서 호출)
   * 매일 실행되어 PENDING_APPROVAL 상태인 BatchCMS 항목들을 확인
   */
  async checkAndUpdateBnplApprovalStatus() {
    this.logger.log('BNPL 승인 상태 확인 시작');

    try {
      // PENDING 상태인 BatchCMS 항목들 조회
      const pendingMethods =
        await this.dbService.db.query.batchCmsMethod.findMany({
          where: eq(schema.batchCmsMethod.status, 'PENDING'),
          // ...필요시 추가 조건
        });

      this.logger.log(
        `승인 대기 중인 BNPL 결제수단: ${pendingMethods.length}개`,
      );

      for (const batchCmsMethod of pendingMethods) {
        try {
          // ✅ 어댑터에게 상태를 물어보기만 함
          const approvalStatus = await this.methodManager.getMemberStatus(
            batchCmsMethod.hmsMemberId,
          );

          // ✅ 어댑터의 답변에 따라 내부 상태만 변경
          if (approvalStatus.status === 'REGISTERED') {
            await this.approveBatchCmsMethod(batchCmsMethod);
          } else if (approvalStatus.status === 'FAILED') {
            // 실패 처리 로직 (예: status FAILED로 변경)
            await this.dbService.db
              .update(schema.batchCmsMethod)
              .set({ status: 'FAILED', updatedAt: new Date() })
              .where(eq(schema.batchCmsMethod.id, batchCmsMethod.id));
          }
          // PENDING이면 아무것도 하지 않고 다음으로 넘어감
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

      // PaymentMethodActivatedEvent 발행 (임시 주석처리)
      // const paymentMethod = await tx.query.paymentMethod.findFirst({
      //   where: eq(schema.paymentMethod.id, batchCmsMethod.paymentMethodId),
      // });

      // if (paymentMethod) {
      //   await this.eventProcessor.emit(
      //     new PaymentMethodActivatedEvent(
      //       paymentMethod.id,
      //       paymentMethod.userId,
      //       paymentMethod.methodType,
      //       {
      //         actor: 'SYSTEM',
      //         correlationId: ulid(),
      //       },
      //     ),
      //   );
      // }
    });
  }
}
