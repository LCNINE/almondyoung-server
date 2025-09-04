/**
 * BNPL 회원 상태 확인 스케줄러
 * - 1분마다 PENDING 상태의 BNPL 계정들을 조회
 * - HMS API로 심사 상태 확인
 * - 승인되면 ACTIVE 상태로 변경
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import * as schema from '../../shared/database/schema';
import { eq, and } from 'drizzle-orm';
import { BnplMethodService } from '../method-services/bnpl-method.service';

@Injectable()
export class BnplStatusScheduler {
  private readonly logger = new Logger(BnplStatusScheduler.name);

  constructor(
    private readonly db: DbService<typeof schema>,
    private readonly bnplMethodService: BnplMethodService,
  ) {}

  /**
   * 1분마다 PENDING 상태 BNPL 결제수단 상태 확인
   * 특별 정책: 회원인증 동안 5만원 임시 한도 제공
   */
  @Cron('0 * * * * *') // 매분 0초에 실행
  async checkPendingBnplMethods() {
    this.logger.log('🔍 BNPL 결제수단 상태 확인 시작 (5만원 임시한도)');

    try {
      // PENDING 상태의 BNPL 결제수단들 조회
      const pendingMethods = await this.db.db
        .select()
        .from(schema.paymentMethod)
        .where(
          and(
            eq(schema.paymentMethod.methodType, 'BNPL'),
            eq(schema.paymentMethod.status, 'PENDING'),
            // 생성된 지 1분 이상 된 결제수단들만 (API 전파 시간 고려)
            // lt(schema.paymentMethod.createdAt, new Date(Date.now() - 60000))
          ),
        );

      if (pendingMethods.length === 0) {
        this.logger.log('⏳ 처리할 PENDING BNPL 결제수단이 없습니다');
        return;
      }

      this.logger.log(
        `📋 ${pendingMethods.length}개의 PENDING BNPL 결제수단을 확인합니다`,
      );

      let activatedCount = 0;
      let rejectedCount = 0;
      let stillPendingCount = 0;

      // 각 결제수단별로 상태 확인 및 업데이트
      for (const method of pendingMethods) {
        try {
          const result = await this.checkAndUpdateMethodStatus(method);

          if (result === 'ACTIVATED') {
            activatedCount++;
          } else if (result === 'REJECTED') {
            rejectedCount++;
          } else {
            stillPendingCount++;
          }
        } catch (error) {
          this.logger.error(
            `❌ 결제수단 ${method.id} 상태 확인 실패: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      }

      this.logger.log(
        `✅ BNPL 결제수단 확인 완료: 활성화=${activatedCount}, 거절=${rejectedCount}, 대기=${stillPendingCount}`,
      );
    } catch (error) {
      this.logger.error(
        `💥 BNPL 결제수단 스케줄러 오류: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * 개별 BNPL 결제수단 상태 확인 및 업데이트
   */
  private async checkAndUpdateMethodStatus(
    method: typeof schema.paymentMethod.$inferSelect,
  ): Promise<'ACTIVATED' | 'REJECTED' | 'PENDING'> {
    this.logger.log(
      `🔎 결제수단 ${method.id} (user: ${method.userId}) 상태 확인`,
    );

    try {
      // HMS API로 회원 상태 확인
      const memberStatus = await this.bnplMethodService.getMemberStatus(
        method.id,
      );

      this.logger.log(
        `📊 결제수단 ${method.id} HMS 상태: ${memberStatus.hmsStatus}`,
      );

      return await this.db.db.transaction(async (tx) => {
        // 연결된 bnplAccount 먼저 조회
        const [bnplAccount] = await tx
          .select()
          .from(schema.bnplAccount)
          .where(eq(schema.bnplAccount.paymentMethodId, method.id))
          .limit(1);

        switch (memberStatus.hmsStatus) {
          case 'APPROVED':
            // 승인됨 → ACTIVE로 변경 (5만원 임시한도)
            await tx
              .update(schema.paymentMethod)
              .set({
                status: 'ACTIVE',
                updatedAt: new Date(),
              })
              .where(eq(schema.paymentMethod.id, method.id));

            if (bnplAccount) {
              // BNPL 계정 활성화 이벤트 로그만 기록
              this.logger.log(
                `📊 BNPL 계정 활성화: ${bnplAccount.id} - 임시한도 50,000원`,
              );
            }

            this.logger.log(
              `✅ 결제수단 ${method.id} ACTIVE로 활성화 완료 (5만원 한도)`,
            );
            return 'ACTIVATED';

          case 'REJECTED':
            // 거절됨 → INACTIVE로 변경 (REJECTED 상태가 없으므로)
            await tx
              .update(schema.paymentMethod)
              .set({
                status: 'INACTIVE',
                updatedAt: new Date(),
              })
              .where(eq(schema.paymentMethod.id, method.id));

            if (bnplAccount) {
              // BNPL 계정 거절 이벤트 로그만 기록
              this.logger.log(
                `❌ BNPL 계정 거절: ${bnplAccount.id} - HMS 응답: ${JSON.stringify(memberStatus)}`,
              );
            }

            this.logger.log(
              `❌ 결제수단 ${method.id} INACTIVE로 변경 완료 (사유: HMS 거절)`,
            );
            return 'REJECTED';

          case 'PENDING':
          case 'UNDER_REVIEW':
            // 여전히 심사 중 → 상태 유지만
            await tx
              .update(schema.paymentMethod)
              .set({
                updatedAt: new Date(),
              })
              .where(eq(schema.paymentMethod.id, method.id));

            this.logger.log(`⏳ 결제수단 ${method.id} 여전히 심사 중`);
            return 'PENDING';

          default:
            this.logger.warn(
              `⚠️  결제수단 ${method.id} 알 수 없는 HMS 상태: ${memberStatus.hmsStatus}`,
            );
            return 'PENDING';
        }
      });
    } catch (error) {
      this.logger.error(
        `💥 결제수단 ${method.id} 상태 확인 중 오류: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }
}
