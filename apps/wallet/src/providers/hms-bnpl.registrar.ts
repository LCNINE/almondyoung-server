import { Injectable, Logger } from '@nestjs/common';
// PaymentError를 사용하여 도메인 에러를 명확히 표현합니다.
import { PaymentError, ProfileRegistrar } from './payment-provider.interface';
import { HmsAPI, MockHmsAPI } from 'hms-api-wrapper'; // 실제 라이브러리 경로
import { HmsApiFactory } from '../shared/utils/hms-api.factory';

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
  private readonly hmsApi: HmsAPI | MockHmsAPI;

  constructor() {
    // 실제 환경에 맞는 API 클라이언트를 생성합니다.
    this.hmsApi = HmsApiFactory.createForBnpl();
  }

  /**
   * HMS BNPL 프로필과 동의서를 함께 등록합니다.
   * 이 과정은 하나의 트랜잭션처럼 동작해야 합니다.
   */
  async register(input: HmsBnplRegisterInput, ctx: { tx: any }) {
    this.logger.log(`➡️ HMS BNPL 프로필/동의서 등록 시작: ${input.memberId}`);

    // --- 1단계: HMS 회원 등록 ---
    const memberResp = await this.hmsApi.members.create({
      memberId: input.memberId,
      memberName: input.memberName,
      payerName: input.payerName,
      paymentKind: 'CMS',
      paymentCompany: input.paymentCompany,
      paymentNumber: input.paymentNumber,
      payerNumber: input.payerNumber,
      phone: input.phone,
    });

    if (memberResp.member.result.flag !== 'Y') {
      const reason = memberResp.member.result.message;
      this.logger.warn(`⚠️ HMS BNPL 회원 등록 실패: ${reason}`);
      // 이제 meta에 reason을 담아도 타입 에러가 발생하지 않습니다.
      return { status: 'FAILED', meta: { reason } };
    }
    this.logger.log(`✅ HMS BNPL 회원 등록 성공: ${input.memberId}`);

    // --- 2단계: 동의서 파일 업로드 ---
    const agreementResp = await this.hmsApi.agreements.register(
      input.custId,
      input.memberId,
      input.agreementFile,
    );

    // 실제 API 응답의 성공/실패 조건으로 변경해야 합니다.
    if (!agreementResp.agreementFile.agreementKey) {
      const reason = '동의서 응답에 agreementKey가 없습니다.';
      this.logger.error(`❌ HMS BNPL 동의서 업로드 실패: ${reason}`);
      // 중요: 이 경우 보상 트랜잭션(회원 삭제)을 호출하는 로직을 추가 고려해야 합니다.
      // await this.hmsApi.members.delete(input.memberId);
      return { status: 'FAILED', meta: { reason } };
    }
    this.logger.log(
      `✅ HMS BNPL 동의서 업로드 성공: ${agreementResp.agreementFile.agreementKey}`,
    );

    // --- 최종 성공 ---
    return {
      externalId: memberResp.member.memberId,
      status: 'SUCCESS', // 또는 API 응답에 따른 실제 상태
      meta: {
        agreementKey: agreementResp.agreementFile.agreementKey,
      },
    };
  }
}
