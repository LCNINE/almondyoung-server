import { DbService, InjectDb } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import { userServiceSchema, UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { and, desc, eq, gt } from 'drizzle-orm';
import { VerifyEmailCodeDto } from '../dto/email-verification.dto';

@Injectable()
export class VerifyEmailCodeService {
  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  async verifyCode(userId: string, dto: VerifyEmailCodeDto) {
    const { code } = dto;
    const purpose = dto.purpose ?? 'password_change';
    const table = userServiceSchema.emailVerifications;

    const [user] = await this.dbService.db
      .select({ email: userServiceSchema.users.email })
      .from(userServiceSchema.users)
      .where(eq(userServiceSchema.users.id, userId))
      .limit(1);
    if (!user?.email) throw new NotFoundError('등록된 이메일이 없습니다');

    // 해당 이메일/용도의 가장 최근 미검증·미만료 요청
    const [verification] = await this.dbService.db
      .select()
      .from(table)
      .where(
        and(
          eq(table.email, user.email),
          eq(table.purpose, purpose),
          eq(table.isVerified, false),
          gt(table.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(table.createdAt))
      .limit(1);

    if (!verification) {
      throw new BadRequestError('인증 요청이 만료되었거나 존재하지 않습니다. 코드를 다시 요청해주세요');
    }
    if (verification.attempts >= verification.maxAttempts) {
      throw new BadRequestError('인증 시도 횟수를 초과했습니다. 코드를 다시 요청해주세요');
    }

    // 코드 불일치 → 시도 횟수 증가 후 실패
    if (verification.code !== code) {
      await this.dbService.db
        .update(table)
        .set({ attempts: verification.attempts + 1 })
        .where(eq(table.id, verification.id));
      const remaining = verification.maxAttempts - verification.attempts - 1;
      throw new BadRequestError(`인증 코드가 일치하지 않습니다 (${remaining}회 남음)`);
    }

    // 인증 성공
    await this.dbService.db
      .update(table)
      .set({ isVerified: true, verifiedAt: new Date() })
      .where(eq(table.id, verification.id));

    return '인증이 완료되었습니다';
  }
}
