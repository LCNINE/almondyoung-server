import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import {
  users,
  type UserServiceSchema,
  type UserServiceTx,
} from 'apps/user-service/database/drizzle/schema';
import { and, count, eq, isNull, ne } from 'drizzle-orm';

/** 계정의 테넌트와 플랫폼 운영자 성질. 바꾸는 쪽은 iam Manager 뿐이다(계정의 테넌트는 만든 뒤 바뀌지 않는다, ADR-0056). */
@Injectable()
export class TenancyRepository {
  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  private client(tx?: UserServiceTx) {
    return tx ?? this.dbService.db;
  }

  // ── 계정의 테넌트

  /** 계정이 없으면 null. */
  async accountTenantOf(userId: string, tx?: UserServiceTx): Promise<string | null> {
    const [row] = await this.client(tx).select({ tenantId: users.tenantId }).from(users).where(eq(users.id, userId));
    return row?.tenantId ?? null;
  }

  // ── 플랫폼 운영자

  async isOperator(userId: string, tx: UserServiceTx): Promise<boolean> {
    const [row] = await tx.select({ op: users.isPlatformOperator }).from(users).where(eq(users.id, userId));
    return row?.op ?? false;
  }

  /** 운영자 행 전부를 잠근다 — 서로 다른 운영자를 동시에 강등·탈퇴시켜도 차례로 세게 한다. */
  async lockOperators(tx: UserServiceTx): Promise<void> {
    await tx.select({ id: users.id }).from(users).where(eq(users.isPlatformOperator, true)).for('update');
  }

  /** `exceptUserId` 를 뺀, 지금 로그인할 수 있는 운영자 수(탈퇴·휴면 제외). 잠근 뒤에 부른다. */
  async countSignInOperators(exceptUserId: string, tx: UserServiceTx): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(users)
      .where(
        and(
          eq(users.isPlatformOperator, true),
          ne(users.id, exceptUserId),
          isNull(users.deletedAt),
          isNull(users.dormantAt),
        ),
      );
    return Number(row?.n ?? 0);
  }

  async setOperator(userId: string, isOperator: boolean, tx: UserServiceTx): Promise<void> {
    await tx.update(users).set({ isPlatformOperator: isOperator, updatedAt: new Date() }).where(eq(users.id, userId));
  }
}
