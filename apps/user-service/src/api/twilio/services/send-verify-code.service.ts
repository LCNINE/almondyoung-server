import { DbService, InjectDb } from '@app/db';
import { Inject, Injectable } from '@nestjs/common';
import {
  userServiceSchema,
  UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { DbTransaction } from 'apps/user-service/src/commons/types';
import { Twilio } from 'twilio';
import { SendVerificationCodeDto } from '../dto/twilio.dto';
import { LookupService } from './lookup.service';
import { CheckResendService } from './check-resend.service';
import { ExpireExistingCodesService } from './expire-existing-codes';

@Injectable()
export class SendMessageService {
  constructor(
    @Inject('TWILIO_PHONE_NUMBER') private readonly twilioPhoneNumber: string,
    @Inject('TWILIO_CLIENT') private readonly twilio: Twilio,
    @Inject('TWILIO_SERVICE_ID') private readonly twilioServiceId: string,
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,

    private readonly lookupService: LookupService,
    private readonly checkResendService: CheckResendService,
    private readonly expireExistingCodesService: ExpireExistingCodesService,
  ) {}

  private async inTx<T>(
    fn: (tx: DbTransaction) => Promise<T>,
    tx?: DbTransaction,
  ) {
    return tx ? fn(tx) : this.dbService.db.transaction(fn);
  }

  async sendVerificationCode(
    sendVerificationCodeDto: SendVerificationCodeDto,
    tx?: DbTransaction,
  ) {
    const { phoneNumber } = sendVerificationCodeDto;

    return this.inTx(async (trx) => {
      // 1. 재발송 쿨타임 체크 (3분)
      await this.checkResendService.checkResend(phoneNumber, trx);

      // 2. 번호 검증 및 국제 형식 변환
      const lookupResult = await this.lookupService.lookup(
        sendVerificationCodeDto,
      );
      const validatedPhoneNumber = lookupResult.phoneNumber; // +82 형식

      // 3. 기존 미검증 코드 만료 처리
      await this.expireExistingCodesService.expireExistingCodes(
        phoneNumber,
        trx,
      );

      // 4. 인증 코드 생성
      const code = this.generateCode();

      // 5. DB에 저장
      await trx.insert(userServiceSchema.phoneVerifications).values({
        phoneNumber,
        code: code.toString(),
        expiresAt: new Date(Date.now() + 3 * 60 * 1000), // 3분
      });

      // 6. SMS 발송
      // Note: 외부 API 호출이 트랜잭션 내부에 있음
      // SMS 실패 시 DB도 함께 롤백됨
      await this.twilio.messages.create({
        to: validatedPhoneNumber,
        from: this.twilioPhoneNumber,
        body: `[아몬드영] 인증번호: ${code}`,
      });

      return '인증번호가 발송되었습니다';
    }, tx);
  }

  private generateCode() {
    return Math.floor(100000 + Math.random() * 900000);
  }
}
