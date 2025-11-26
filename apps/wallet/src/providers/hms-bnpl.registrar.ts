import { Injectable, Logger } from '@nestjs/common';
// PaymentError를 사용하여 도메인 에러를 명확히 표현합니다.
import { PaymentError, ProfileRegistrar } from './payment-provider.interface';
import { HmsBatchCmsService } from '../services/hms-batch-cms.service';

/**
 * HmsBnplRegistrar.register 메서드의 명확한 입력 타입 정의
 */
export interface HmsBnplRegisterInput {
  userId: string;
  custId: string; // 동의서 업로드에 필요한 custId
  memberId: string;
  memberName: string;
  payerName: string;
  paymentCompany: string;
  paymentNumber: string; // 계좌번호 등
  payerNumber: string; // 생년월일 등
  phone: string;
  // 동의서 파일 정보 추가
  agreementFile: {
    file: Buffer;
    filename: string;
  };
}

@Injectable()
export class HmsBnplRegistrar
  implements
    ProfileRegistrar<
      HmsBnplRegisterInput,
      Record<string, never> // Meta Type (BNPL은 특별한 메타 데이터 없음)
    >
{
  private readonly logger = new Logger(HmsBnplRegistrar.name);

  constructor(private readonly hmsBatchCmsService: HmsBatchCmsService) {}

  /**
   * HMS BNPL 프로필과 동의서를 함께 등록합니다.
   * 이 과정은 하나의 트랜잭션처럼 동작해야 합니다.
   */
  async register(input: HmsBnplRegisterInput, ctx: { tx: any }) {
    this.logger.log(`➡️ HMS BNPL 프로필/동의서 등록 시작: ${input.memberId}`);

    try {
      // --- 1단계: HMS 회원 등록 ---
      const memberResult = await this.hmsBatchCmsService.createMember({
        memberId: input.memberId,
        memberName: input.memberName,
        payerName: input.payerName,
        paymentKind: 'CMS',
        paymentCompany: input.paymentCompany,
        paymentNumber: input.paymentNumber,
        payerNumber: input.payerNumber,
        phone: input.phone,
      });

      if (!memberResult.success) {
        const reason = memberResult.message || '회원 등록 실패';
        this.logger.warn(`⚠️ HMS BNPL 회원 등록 실패: ${reason}`);
        return { status: 'FAILED', meta: { reason } };
      }

      this.logger.log(`✅ HMS BNPL 회원 등록 성공: ${input.memberId}`);

      // --- 2단계: 동의서 파일 업로드 ---
      try {
        const agreementResult = await this.hmsBatchCmsService.registerAgreement(
          input.custId,
          memberResult.memberId!, // 회원 등록에서 받은 memberId 사용
          input.agreementFile.file,
          input.agreementFile.filename,
        );

        if (!agreementResult.success) {
          const reason = agreementResult.message || '동의서 등록 실패';
          this.logger.error(`❌ HMS BNPL 동의서 업로드 실패: ${reason}`);

          // 🚨 보상 트랜잭션: 등록된 회원 삭제
          this.logger.log(
            `🔄 보상 트랜잭션 시작: 회원 삭제 요청 - ${memberResult.memberId}`,
          );
          try {
            await this.hmsBatchCmsService.deleteMember(memberResult.memberId!);
            this.logger.log(
              `✅ 보상 트랜잭션 완료: 회원 삭제 성공 - ${memberResult.memberId}`,
            );
          } catch (rollbackError) {
            // 롤백 실패는 로그만 남기고 원래 에러를 던짐
            const rollbackMessage =
              rollbackError instanceof Error
                ? rollbackError.message
                : String(rollbackError);
            this.logger.error(
              `❌ 보상 트랜잭션 실패: 회원 삭제 중 오류 - ${rollbackMessage}`,
            );
            // 원래 에러에 롤백 실패 정보 추가
            throw new Error(
              `동의서 등록 실패 및 회원 삭제 실패: ${reason} (롤백 실패: ${rollbackMessage})`,
            );
          }

          return { status: 'FAILED', meta: { reason } };
        }

        this.logger.log(
          `✅ HMS BNPL 동의서 업로드 성공: ${agreementResult.agreementKey}`,
        );

        // --- 최종 성공 ---
        return {
          externalId: memberResult.memberId!,
          status: 'SUCCESS',
          meta: {
            agreementKey: agreementResult.agreementKey,
          },
        };
      } catch (agreementError) {
        // 동의서 등록 중 예외 발생 시 보상 트랜잭션 수행
        const agreementErrorMessage =
          agreementError instanceof Error
            ? agreementError.message
            : String(agreementError);
        this.logger.error(
          `❌ HMS BNPL 동의서 업로드 중 예외 발생: ${agreementErrorMessage}`,
        );

        // 🚨 보상 트랜잭션: 등록된 회원 삭제
        this.logger.log(
          `🔄 보상 트랜잭션 시작: 회원 삭제 요청 - ${memberResult.memberId}`,
        );
        try {
          await this.hmsBatchCmsService.deleteMember(memberResult.memberId!);
          this.logger.log(
            `✅ 보상 트랜잭션 완료: 회원 삭제 성공 - ${memberResult.memberId}`,
          );
        } catch (rollbackError) {
          // 롤백 실패는 로그만 남기고 원래 에러를 던짐
          const rollbackMessage =
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError);
          this.logger.error(
            `❌ 보상 트랜잭션 실패: 회원 삭제 중 오류 - ${rollbackMessage}`,
          );
        }

        // 원래 에러를 다시 던짐
        throw agreementError;
      }
    } catch (error) {
      // 에러는 HmsBatchCmsService에서 이미 로깅됨
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `❌ HMS BNPL 등록 중 예상치 못한 에러 발생: ${errorMessage}`,
      );
      throw error;
    }
  }
}
