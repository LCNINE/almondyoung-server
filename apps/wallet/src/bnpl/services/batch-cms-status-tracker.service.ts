import { Injectable, Logger } from '@nestjs/common';
import { InjectDb } from '@app/db';
import { DbService } from '@app/db/db.service';
import * as schema from '../../shared/schemas/schema';
import { eq } from 'drizzle-orm';

/**
 * BatchCMS 등록 상태 추적 서비스
 * 
 * 기존 batchCmsMethod 테이블을 활용하여 BatchCMS 상태를 추적
 * 
 * 주요 기능:
 * 1. BatchCMS 회원 등록 상태 추적
 * 2. 주기적 상태 확인 및 업데이트
 * 3. 등록 완료/실패 처리
 * 4. 지연 알림 처리
 */
@Injectable()
export class BatchCmsStatusTrackerService {
  private readonly logger = new Logger(BatchCmsStatusTrackerService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {}

  /**
   * BatchCMS 등록 상태 추적 시작
   * batchCmsMethod 테이블의 기존 레코드를 활용
   */
  async startTracking(paymentMethodId: string): Promise<void> {
    this.logger.log(`BatchCMS 상태 추적 시작: ${paymentMethodId}`);

    try {
      // batchCmsMethod 테이블에서 해당 결제수단 조회
      const batchCmsMethod = await this.dbService.db.query.batchCmsMethod.findFirst({
        where: eq(schema.batchCmsMethod.paymentMethodId, paymentMethodId),
      });

      if (!batchCmsMethod) {
        throw new Error(`BatchCMS 메서드를 찾을 수 없습니다: ${paymentMethodId}`);
      }

      // 상태가 PENDING이 아니면 이미 처리된 것
      if (batchCmsMethod.status !== 'PENDING') {
        this.logger.warn(`이미 처리된 BatchCMS 메서드: ${paymentMethodId}, 상태: ${batchCmsMethod.status}`);
        return;
      }

      this.logger.log(`BatchCMS 상태 추적 시작 완료: ${paymentMethodId}`);
    } catch (error) {
      this.logger.error(`BatchCMS 상태 추적 시작 실패: ${paymentMethodId}`, error);
      throw error;
    }
  }

  /**
   * BatchCMS 등록 상태 확인 및 업데이트
   */
  async checkRegistrationStatus(paymentMethodId: string): Promise<BatchCmsStatus> {
    this.logger.log(`BatchCMS 등록 상태 확인: ${paymentMethodId}`);

    try {
      const batchCmsMethod = await this.dbService.db.query.batchCmsMethod.findFirst({
        where: eq(schema.batchCmsMethod.paymentMethodId, paymentMethodId),
        with: {
          paymentMethod: true,
        },
      });

      if (!batchCmsMethod) {
        throw new Error(`BatchCMS 메서드를 찾을 수 없습니다: ${paymentMethodId}`);
      }

      // TODO: 실제 HMS API 호출하여 상태 확인
      // const hmsStatus = await this.hmsApiService.checkMemberStatus(batchCmsMethod.hmsMemberId);
      
      // 임시로 3일 경과 시 등록 완료로 처리
      const daysSinceCreation = Math.floor(
        (Date.now() - batchCmsMethod.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      let newStatus = batchCmsMethod.status;

      if (batchCmsMethod.status === 'PENDING' && daysSinceCreation >= 3) {
        newStatus = 'APPROVED';
        
        this.logger.log(`BatchCMS 등록 완료 감지: ${paymentMethodId}`);
        await this.handleRegistrationComplete(paymentMethodId);
      }

      // 상태 업데이트
      if (newStatus !== batchCmsMethod.status) {
        await this.dbService.db
          .update(schema.batchCmsMethod)
          .set({
            status: newStatus,
            updatedAt: new Date(),
          })
          .where(eq(schema.batchCmsMethod.paymentMethodId, paymentMethodId));
      }

      return {
        paymentMethodId,
        memberId: batchCmsMethod.hmsMemberId,
        status: newStatus,
        createdAt: batchCmsMethod.createdAt,
        updatedAt: new Date(),
        daysElapsed: daysSinceCreation,
      };
    } catch (error) {
      this.logger.error(`BatchCMS 등록 상태 확인 실패: ${paymentMethodId}`, error);
      throw error;
    }
  }

  /**
   * BatchCMS 등록 완료 처리
   */
  async handleRegistrationComplete(paymentMethodId: string): Promise<void> {
    this.logger.log(`BatchCMS 등록 완료 처리: ${paymentMethodId}`);

    try {
      // PaymentMethod 상태를 ACTIVE로 변경
      await this.dbService.db
        .update(schema.paymentMethod)
        .set({
          status: 'ACTIVE',
          updatedAt: new Date(),
        })
        .where(eq(schema.paymentMethod.id, paymentMethodId));

      // BNPL 계정도 찾아서 상태 업데이트 (필요시)
      const bnplAccount = await this.dbService.db.query.bnplAccount.findFirst({
        where: eq(schema.bnplAccount.paymentMethodId, paymentMethodId),
      });

      if (bnplAccount) {
        await this.dbService.db
          .update(schema.bnplAccount)
          .set({
            status: 'ACTIVE',
            updatedAt: new Date(),
          })
          .where(eq(schema.bnplAccount.id, bnplAccount.id));
      }

      this.logger.log(`BatchCMS 등록 완료 처리 완료: ${paymentMethodId}`);
    } catch (error) {
      this.logger.error(`BatchCMS 등록 완료 처리 실패: ${paymentMethodId}`, error);
      throw error;
    }
  }

  /**
   * BatchCMS 등록 실패 재시도
   */
  async retryRegistration(paymentMethodId: string): Promise<void> {
    this.logger.log(`BatchCMS 등록 재시도: ${paymentMethodId}`);

    try {
      const batchCmsMethod = await this.dbService.db.query.batchCmsMethod.findFirst({
        where: eq(schema.batchCmsMethod.paymentMethodId, paymentMethodId),
      });

      if (!batchCmsMethod) {
        throw new Error(`BatchCMS 메서드를 찾을 수 없습니다: ${paymentMethodId}`);
      }

      // hmsMetadata에서 재시도 횟수 추출 (JSON 파싱)
      const metadata = batchCmsMethod.hmsMetadata ? JSON.parse(batchCmsMethod.hmsMetadata) : {};
      const currentRetryCount = metadata.retryCount || 0;
      const newRetryCount = currentRetryCount + 1;
      const maxRetries = 5;

      if (newRetryCount > maxRetries) {
        this.logger.error(`BatchCMS 등록 최대 재시도 횟수 초과: ${paymentMethodId}`);
        
        // 상태를 FAILED로 변경
        await this.dbService.db
          .update(schema.batchCmsMethod)
          .set({
            status: 'FAILED',
            hmsMetadata: JSON.stringify({
              ...metadata,
              retryCount: newRetryCount,
              errorMessage: '최대 재시도 횟수 초과',
              lastRetryAt: new Date().toISOString(),
            }),
            updatedAt: new Date(),
          })
          .where(eq(schema.batchCmsMethod.paymentMethodId, paymentMethodId));
        
        return;
      }

      // TODO: 실제 HMS API 재호출
      // await this.hmsApiService.registerMember(memberData);

      // 재시도 횟수 업데이트
      await this.dbService.db
        .update(schema.batchCmsMethod)
        .set({
          hmsMetadata: JSON.stringify({
            ...metadata,
            retryCount: newRetryCount,
            lastRetryAt: new Date().toISOString(),
          }),
          updatedAt: new Date(),
        })
        .where(eq(schema.batchCmsMethod.paymentMethodId, paymentMethodId));

      this.logger.log(`BatchCMS 등록 재시도 완료: ${paymentMethodId}, 재시도 횟수: ${newRetryCount}`);
    } catch (error) {
      this.logger.error(`BatchCMS 등록 재시도 실패: ${paymentMethodId}`, error);
      throw error;
    }
  }

  /**
   * 5일 초과 지연 알림
   */
  async notifyDelayedRegistration(paymentMethodId: string): Promise<void> {
    this.logger.warn(`BatchCMS 등록 지연 알림: ${paymentMethodId}`);

    try {
      const batchCmsMethod = await this.dbService.db.query.batchCmsMethod.findFirst({
        where: eq(schema.batchCmsMethod.paymentMethodId, paymentMethodId),
      });

      if (!batchCmsMethod) {
        return;
      }

      const daysSinceCreation = Math.floor(
        (Date.now() - batchCmsMethod.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysSinceCreation >= 5) {
        // TODO: 실제 알림 서비스 연동
        this.logger.warn(
          `BatchCMS 등록이 ${daysSinceCreation}일째 지연되고 있습니다: ${paymentMethodId}`
        );
        
        // 알림 발송 로직 추가
        // await this.notificationService.sendDelayAlert(paymentMethodId, daysSinceCreation);
      }
    } catch (error) {
      this.logger.error(`BatchCMS 지연 알림 처리 실패: ${paymentMethodId}`, error);
    }
  }

  /**
   * 모든 PENDING 상태 BatchCMS 메서드들의 상태 확인 (스케줄러용)
   */
  async checkAllPendingRegistrations(): Promise<void> {
    this.logger.log('모든 PENDING 상태 BatchCMS 등록 확인 시작');

    try {
      const pendingMethods = await this.dbService.db.query.batchCmsMethod.findMany({
        where: eq(schema.batchCmsMethod.status, 'PENDING'),
      });

      this.logger.log(`PENDING 상태 BatchCMS 등록: ${pendingMethods.length}개`);

      for (const method of pendingMethods) {
        try {
          await this.checkRegistrationStatus(method.paymentMethodId);
          
          // 5일 이상 지연된 경우 알림
          const daysSinceCreation = Math.floor(
            (Date.now() - method.createdAt.getTime()) / (1000 * 60 * 60 * 24)
          );
          
          if (daysSinceCreation >= 5) {
            await this.notifyDelayedRegistration(method.paymentMethodId);
          }
        } catch (error) {
          this.logger.error(`개별 BatchCMS 상태 확인 실패: ${method.paymentMethodId}`, error);
        }
      }

      this.logger.log('모든 PENDING 상태 BatchCMS 등록 확인 완료');
    } catch (error) {
      this.logger.error('PENDING 상태 BatchCMS 등록 확인 중 오류 발생', error);
    }
  }
}

/**
 * BatchCMS 상태 인터페이스 (기존 스키마 기반)
 */
export interface BatchCmsStatus {
  paymentMethodId: string;
  memberId: string;
  status: string; // 'PENDING' | 'APPROVED' | 'FAILED' 등
  createdAt: Date;
  updatedAt: Date;
  daysElapsed: number;
}