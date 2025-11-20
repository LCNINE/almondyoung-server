import { Injectable, Logger } from '@nestjs/common';
import { ProfileRegistrar } from './payment-provider.interface';
import { HmsAPI } from 'hms-api-wrapper';
import { HmsApiFactory } from '../shared/utils/hms-api.factory';

@Injectable()
export class HmsCardRegistrar
  implements
    ProfileRegistrar<
      // Input Type: 프로필 등록에 필요한 정보
      {
        userId: string;
        payerName: string;
        phone: string;
        paymentCompany?: string;
        // ... HmsCardProfileRequest에서 필요했던 다른 필드들
        memberId: string; // 예시: 외부에서 생성된 ID
        paymentNumber: string; // 카드번호 등
        validYear: string;
        validMonth: string;
        password?: string;
        memberName: string;
      },
      // Meta Type: 등록 후 반환할 추가 정보
      {
        cardBrand?: string;
        last4?: string;
      }
    >
{
  private readonly logger = new Logger(HmsCardRegistrar.name);
  private readonly hmsApi: HmsAPI;

  constructor() {
    // HmsApiFactory를 사용하여 프록시 지원 (Real API만)
    this.hmsApi = HmsApiFactory.createForCard();
    this.logger.log('🔧 HMS Card Registrar 초기화 완료 (Real API)');
  }

  async register(input: any, ctx: { tx: any }) {
    this.logger.log(`➡️ HMS 카드 프로필 등록 요청: ${input.userId}`);

    const requestData = {
      memberId: input.memberId,
      paymentKind: 'CARD' as const,
      payerNumber: input.payerNumber,
      paymentNumber: input.paymentNumber,
      payerName: input.payerName,
      phone: input.phone,
      memberName: input.memberName,
      validYear: input.validYear,
      validMonth: input.validMonth,
      password: input.password,
      paymentCompany: input.paymentCompany || '', // 기본값 설정
    };

    this.logger.debug(
      `📤 HMS API 요청 데이터:`,
      JSON.stringify(requestData, null, 2),
    );

    try {
      this.logger.log(`⏳ HMS API 호출 시작...`);
      const resp = await this.hmsApi.paymentProfiles.create(requestData);
      this.logger.log(`✅ HMS API 응답 받음`);

      // 인터페이스 계약(return type)에 맞춰 결과를 반환합니다.
      return {
        externalId: resp.member.memberId,
        status: resp.member.result.flag === 'Y' ? 'SUCCESS' : 'FAILED', // API 응답을 우리 시스템 상태로 변환
        meta: {
          // API 응답에서 카드 브랜드나 마지막 4자리 같은 유용한 정보를 추출해 meta에 담을 수 있습니다.
          cardBrand: resp.member.paymentCompany, // 카드 브랜드
          last4: resp.member.paymentNumber, // 마지막 4자리
          payerName: resp.member.payerName, // 납부자 이름
          phone: resp.member.phone, // 전화번호
          paymentCompany: resp.member.paymentCompany, // 결제 기관
          memberName: resp.member.memberName, // 회원 이름
        },
      };
    } catch (err: any) {
      this.logger.error(
        `❌ HMS 카드 프로필 등록 실패: ${err.message}`,
        err.stack,
      );
      // 실패 시에도 인터페이스에 정의된 에러 형식을 따르는 것이 좋습니다.
      // 여기서는 간단히 에러를 다시 던져 상위 서비스에서 처리하도록 합니다.
      throw new Error(`HMS 프로필 등록 실패: ${err.message}`);
    }
  }
}
