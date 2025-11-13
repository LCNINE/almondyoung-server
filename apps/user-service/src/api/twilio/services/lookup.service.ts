import { Inject, Injectable, Logger } from '@nestjs/common';
import { Twilio } from 'twilio';
import { LookupDto } from '../dto/twilio.dto';
import { TwilioLookupException } from '../exceptions/twilio.exceptions';

@Injectable()
export class LookupService {
  private readonly logger = new Logger(LookupService.name);

  constructor(@Inject('TWILIO_CLIENT') private readonly twilio: Twilio) {}

  async lookup(lookupDto: LookupDto) {
    const { phoneNumber, countryCode } = lookupDto;

    try {
      const result = await this.twilio.lookups.v2
        .phoneNumbers(phoneNumber)
        .fetch({ countryCode: countryCode.toUpperCase() });

      // 번호조회 result의 validation 에러 체크
      this.validateLookupResult(result);

      return result;
    } catch (error) {
      if (error instanceof TwilioLookupException) {
        throw error;
      }

      // 기타  twilio측에서 에러 발생했을때를 대비해서
      this.logger.error(`Twilio Lookup API 에러 발생`, {
        code: error.code,
        message: error.message,
        status: error.status,
      });

      throw new TwilioLookupException({
        message: `전화번호 조회 중 오류가 발생했습니다: ${error.message}`,
        httpStatus: error.status,
      });
    }
  }

  // 번호조회 result의 validation 에러 체크
  private validateLookupResult(result: any) {
    if (result.validationErrors?.length > 0) {
      const errorMessage = result.validationErrors.join(', ');

      this.logger.warn(`전화번호 검증 실패: ${errorMessage}`);
      throw new TwilioLookupException({
        message: errorMessage,
      });
    }
  }
}
