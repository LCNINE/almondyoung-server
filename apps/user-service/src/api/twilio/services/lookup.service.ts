import { Inject, Injectable, Logger } from '@nestjs/common';
import { Twilio } from 'twilio';
import { LookupDto } from '../dto/twilio.dto';

@Injectable()
export class LookupService {
  private readonly logger = new Logger(LookupService.name);
  constructor(@Inject('TWILIO_CLIENT') private readonly twilio: Twilio) {}

  async lookup(lookupDto: LookupDto) {
    const { phoneNumber, countryCode } = lookupDto;

    const result = await this.twilio.lookups.v2
      .phoneNumbers(phoneNumber)
      .fetch();

    if (result.validationErrors.length > 0) {
      this.logger.warn('번호조회 에러:', {
        validationErrors: result.validationErrors,
      });

      return null;
    }

    console.log('result:', result);

    return {
      phoneNumber: result.phoneNumber,
      valid: result.valid,
    };
  }
}
