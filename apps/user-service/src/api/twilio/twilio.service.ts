import { DbService, InjectDb } from '@app/db';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import twilio from 'twilio';
import { DbTransaction } from '../../commons/types';

@Injectable()
export default class TwilioService {
  private readonly logger = new Logger(TwilioService.name);

  private twilioClient: twilio.Twilio;
  private fromNumber: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
  ) {
    const accountSid = this.configService.getOrThrow('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.getOrThrow('TWILIO_AUTH_TOKEN');
    this.fromNumber = this.configService.getOrThrow('TWILIO_PHONE_NUMBER');

    this.twilioClient = twilio(accountSid, authToken);
  }
  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  async sendVerifyCode(
    phoneNumber: string,
    tx?: DbTransaction,
  ): Promise<{ messageSid: string }> {
    try {
      const message = await this.twilioClient.messages.create({
        body: `[아몬드영] 인증번호는 123456입니다.`,
        from: this.fromNumber,
        to: phoneNumber,
      });

      this.logger.log('SMS 발송 성공:', message.sid);

      return { messageSid: message.sid };
    } catch (error) {
      this.logger.error('SMS 발송 실패:', error);
      throw error;
    }
  }
}
