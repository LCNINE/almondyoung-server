import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import {
  userServiceSchema,
  UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { DbTransaction } from 'apps/user-service/src/commons/types';
import { and, desc, eq, gt } from 'drizzle-orm';
import { VerifyCodeDto } from '../dto/verify-code.dto';
import { TwilioException } from '../exceptions/twilio.exceptions';

/**
 * 사용자가 입력한 인증번호를 검증하는 서비스
 *
 */
@Injectable()
export class VerifyCodeService {
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
  ) {}

  private getClient(tx?: DbTransaction) {
    return tx ?? this.dbService.db;
  }

  async verifyCode(verifyCodeDto: VerifyCodeDto, tx?: DbTransaction) {
    const { phoneNumber, code } = verifyCodeDto;

    const client = this.getClient(tx);

    const alreadyVerified = await this.alreadyVerified(phoneNumber, code, tx);
    if (alreadyVerified) {
      return '인증이 완료되었습니다';
    }

    // 가장 최근의 유효한 코드만 조회
    const verification = await this.findValidVerification(
      phoneNumber,
      code,
      tx,
    );

    if (!verification) {
      throw new TwilioException({
        message: '잘못된 인증 코드입니다',
        errorCode: 'TWILIO_INVALID_CODE_EXCEPTION',
        httpStatus: HttpStatus.BAD_REQUEST,
      });
    }

    // 시도 횟수 체크
    if (verification.attempts >= verification.maxAttempts) {
      throw new TwilioException({
        message: '인증 시도 횟수를 초과했습니다',
        errorCode: 'TWILIO_MAX_ATTEMPTS_EXCEPTION',
        httpStatus: HttpStatus.BAD_REQUEST,
      });
    }

    // 코드 불일치 시 attempts 증가
    if (verification.code !== code) {
      await client
        .update(userServiceSchema.phoneVerifications)
        .set({
          attempts: verification.attempts + 1,
        })
        .where(eq(userServiceSchema.phoneVerifications.id, verification.id));

      const remainingAttempts =
        verification.maxAttempts - verification.attempts - 1;

      throw new TwilioException({
        message: `인증 코드가 일치하지 않습니다 (${remainingAttempts}회 남음)`,
        errorCode: 'INVALID_VERIFICATION_CODE',
        httpStatus: HttpStatus.BAD_REQUEST,
      });
    }

    // 인증 성공
    await client
      .update(userServiceSchema.phoneVerifications)
      .set({
        isVerified: true,
        verifiedAt: new Date(),
      })
      .where(eq(userServiceSchema.phoneVerifications.id, verification.id));

    return '인증이 완료되었습니다';
  }

  // 이미 인증된 코드인지 확인
  private async alreadyVerified(
    phoneNumber: string,
    code: string,
    tx?: DbTransaction,
  ) {
    const client = this.getClient(tx);

    const [alreadyVerified] = await client
      .select()
      .from(userServiceSchema.phoneVerifications)
      .where(
        and(
          eq(userServiceSchema.phoneVerifications.phoneNumber, phoneNumber),
          eq(userServiceSchema.phoneVerifications.code, code),
          eq(userServiceSchema.phoneVerifications.isVerified, true),
        ),
      )
      .orderBy(desc(userServiceSchema.phoneVerifications.createdAt))
      .limit(1);

    return alreadyVerified;
  }

  // 유효한 인증 코드 조회
  private async findValidVerification(
    phoneNumber: string,
    code: string,
    tx?: DbTransaction,
  ) {
    const client = this.getClient(tx);

    const [verification] = await client
      .select()
      .from(userServiceSchema.phoneVerifications)
      .where(
        and(
          eq(userServiceSchema.phoneVerifications.phoneNumber, phoneNumber),
          eq(userServiceSchema.phoneVerifications.code, code),
          eq(userServiceSchema.phoneVerifications.isVerified, false),
          gt(userServiceSchema.phoneVerifications.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(userServiceSchema.phoneVerifications.createdAt))
      .limit(1);

    return verification;
  }
}
