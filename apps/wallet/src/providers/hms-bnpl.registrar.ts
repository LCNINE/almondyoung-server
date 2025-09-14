import { Injectable, Logger } from '@nestjs/common';
import { ProfileRegistrar } from './payment-provider.interface';
import { HmsAPI, MockHmsAPI } from 'hms-api-wrapper'; // 실제 라이브러리 경로
import { HmsApiFactory } from '../shared/utils/hms-api.factory';

@Injectable()
export class HmsBnplRegistrar
  implements
    ProfileRegistrar<
      // Input Type
      {
        userId: string;
        memberId: string;
        memberName: string;
        payerName: string;
        paymentCompany: string;
        paymentNumber: string; // 계좌번호 등
        payerNumber: string; // 생년월일 등
        phone: string;
      },
      // Meta Type (BNPL은 특별한 메타 데이터가 없을 수 있음)
      Record<string, never>
    >
{
  private readonly logger = new Logger(HmsBnplRegistrar.name);
  private readonly hmsApi: HmsAPI | MockHmsAPI;

  constructor() {
    this.hmsApi = HmsApiFactory.createForBnpl();
  }

  async register(input: any, ctx: { tx: any }) {
    this.logger.log(`➡️ HMS BNPL 회원 등록 요청: ${input.userId}`);
    try {
      const resp = await this.hmsApi.members.create({
        memberId: input.memberId,
        memberName: input.memberName,
        payerName: input.payerName,
        paymentKind: 'CMS',
        paymentCompany: input.paymentCompany,
        paymentNumber: input.paymentNumber,
        payerNumber: input.payerNumber,
        phone: input.phone,
      });

      // 인터페이스 계약에 맞춰 결과 반환
      return {
        externalId: resp.member.memberId,
        status: resp.member.result.flag === 'Y' ? 'SUCCESS' : 'FAILED',
        // meta는 비워둡니다.
      };
    } catch (err: any) {
      this.logger.error(
        `❌ HMS BNPL 회원 등록 실패: ${err.message}`,
        err.stack,
      );
      throw new Error(`HMS BNPL 프로필 등록 실패: ${err.message}`);
    }
  }
}
