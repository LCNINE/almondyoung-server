import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import { userServiceSchema, UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { and, eq, gt } from 'drizzle-orm';

// 최근 본인확인(코드 인증) 통과 여부를 확인하는 서비스.
// 비밀번호 변경 페이지 등 민감한 화면의 서버 사이드 가드에 사용한다.
const VERIFY_WINDOW_MS = 10 * 60 * 1000; // 인증 후 10분간 유효

// 번호 포맷(+8210.. vs 010..) 차이를 흡수하기 위해 끝 8자리로 비교
function last8(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '').slice(-8);
}

@Injectable()
export class IdentityVerificationService {
  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  async isVerified(userId: string, purpose: 'password_change' | 'phone_verify'): Promise<boolean> {
    const windowStart = new Date(Date.now() - VERIFY_WINDOW_MS);

    const [me] = await this.dbService.db
      .select({
        email: userServiceSchema.users.email,
        phone: userServiceSchema.profiles.phoneNumber,
      })
      .from(userServiceSchema.users)
      .leftJoin(userServiceSchema.profiles, eq(userServiceSchema.users.id, userServiceSchema.profiles.userId))
      .where(eq(userServiceSchema.users.id, userId))
      .limit(1);

    if (!me) return false;

    // 이메일 코드로 통과했는지 (이메일 문자열은 정확히 일치)
    if (me.email) {
      const [row] = await this.dbService.db
        .select({ id: userServiceSchema.emailVerifications.id })
        .from(userServiceSchema.emailVerifications)
        .where(
          and(
            eq(userServiceSchema.emailVerifications.email, me.email),
            eq(userServiceSchema.emailVerifications.purpose, purpose),
            eq(userServiceSchema.emailVerifications.isVerified, true),
            gt(userServiceSchema.emailVerifications.verifiedAt, windowStart),
          ),
        )
        .limit(1);
      if (row) return true;
    }

    // 문자(SMS) 코드로 통과했는지 (번호 포맷 차이는 끝 8자리로 비교)
    const target = last8(me.phone);
    if (target) {
      const rows = await this.dbService.db
        .select({ phoneNumber: userServiceSchema.phoneVerifications.phoneNumber })
        .from(userServiceSchema.phoneVerifications)
        .where(
          and(
            eq(userServiceSchema.phoneVerifications.purpose, purpose),
            eq(userServiceSchema.phoneVerifications.isVerified, true),
            gt(userServiceSchema.phoneVerifications.verifiedAt, windowStart),
          ),
        );
      if (rows.some((r) => last8(r.phoneNumber) === target)) return true;
    }

    return false;
  }
}
