import { DbService, InjectDb } from '@app/db';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { userServiceSchema, userServiceEnums, UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { DbTransaction } from 'apps/user-service/src/commons/types';
import { and, eq, gt } from 'drizzle-orm';
import { Twilio } from 'twilio';
import { SendVerificationCodeDto } from '../dto/twilio.dto';
import { TwilioException } from '../exceptions/twilio.exceptions';
import { LookupService } from './lookup.service';
import { ExpireExistingCodesService } from './expire-existing-codes';

/**
 * 발송 제한은 **전화번호 기준**으로 센다.
 *
 * 컨트롤러의 ThrottlerGuard 는 `req.ip` 로 세는데, 이 API 를 부르는 건 브라우저가 아니라
 * auth-web / storefront 의 서버(Lambda)다. 그래서 user-service 에는 최종 사용자 IP 가 아니라
 * 호출한 서버의 IP 몇 개만 도착하고, "1인당 3회" 가 "여러 사용자가 3회를 나눠 쓰는" 상태가 된다
 * (아이디·비밀번호 찾기에서 인증문자가 안 온다는 CS 의 원인). 프록시 뒤에서도 정확한 기준은 번호다.
 */
const RESEND_WINDOW_MS = 60 * 1000;
const RESEND_LIMIT = 3;

@Injectable()
export class SendMessageService {
  constructor(
    @Inject('TWILIO_PHONE_NUMBER') private readonly twilioPhoneNumber: string,
    @Inject('TWILIO_CLIENT') private readonly twilio: Twilio,
    @Inject('TWILIO_SERVICE_ID') private readonly twilioServiceId: string,
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,

    private readonly lookupService: LookupService,
    private readonly expireExistingCodesService: ExpireExistingCodesService,
  ) {}

  private async inTx<T>(fn: (tx: DbTransaction) => Promise<T>, tx?: DbTransaction) {
    return tx ? fn(tx) : this.dbService.db.transaction(fn);
  }

  async sendVerificationCode(sendVerificationCodeDto: SendVerificationCodeDto, tx?: DbTransaction) {
    const { phoneNumber, purpose } = sendVerificationCodeDto;
    const _purpose = purpose ?? 'phone_verify';

    return this.inTx(async (trx) => {
      // 0. 이 번호로 최근 1분 내 발송 횟수 확인 (IP 가 아니라 번호 기준 — 위 주석 참고)
      const recentSends = await trx
        .select({ id: userServiceSchema.phoneVerifications.id })
        .from(userServiceSchema.phoneVerifications)
        .where(
          and(
            eq(userServiceSchema.phoneVerifications.phoneNumber, phoneNumber),
            gt(userServiceSchema.phoneVerifications.createdAt, new Date(Date.now() - RESEND_WINDOW_MS)),
          ),
        )
        .limit(RESEND_LIMIT);

      if (recentSends.length >= RESEND_LIMIT) {
        throw new TwilioException({
          message: '인증번호는 1분에 3회까지 요청할 수 있습니다. 잠시 후 다시 시도해주세요',
          errorCode: 'TWILIO_RESEND_LIMIT_EXCEEDED',
          httpStatus: HttpStatus.TOO_MANY_REQUESTS,
        });
      }

      // 1. 번호 검증 및 국제 형식 변환
      const lookupResult = await this.lookupService.lookup(sendVerificationCodeDto);
      const validatedPhoneNumber = lookupResult.phoneNumber; // +82 형식

      // 2. 기존 미검증 코드 만료 처리
      await this.expireExistingCodesService.expireExistingCodes(phoneNumber, trx);

      // 3. 인증 코드 생성
      const code = this.generateCode();

      // 4. DB에 저장
      await trx.insert(userServiceSchema.phoneVerifications).values({
        phoneNumber,
        code: code.toString(),
        purpose: _purpose,
        expiresAt: new Date(Date.now() + 3 * 60 * 1000), // 3분
      });

      // 5. SMS 발송
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
