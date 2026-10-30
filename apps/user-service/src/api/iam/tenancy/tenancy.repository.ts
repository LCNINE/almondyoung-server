import { DbService, InjectDb } from '@app/db';
import { Injectable } from '@nestjs/common';
import {
  tenantMemberships,
  users,
  type UserServiceSchema,
  type UserServiceTx,
} from 'apps/user-service/database/drizzle/schema';
import { and, count, eq, isNull, ne } from 'drizzle-orm';

/** 소속(계정 ↔ 테넌트)과 플랫폼 운영자 성질. 바꾸는 쪽은 iam Manager 뿐이다. */
@Injectable()
export class TenancyRepository {
  constructor(@InjectDb() private readonly dbService: DbService<UserServiceSchema>) {}

  private client(tx?: UserServiceTx) {
    return tx ?? this.dbService.db;
  }

  // ── 소속

  async tenantsOf(userId: string, tx?: UserServiceTx): Promise<string[]> {
    const rows = await this.client(tx)
      .select({ tenantId: tenantMemberships.tenantId })
      .from(tenantMemberships)
      .where(eq(tenantMemberships.userId, userId))
      .orderBy(tenantMemberships.tenantId);
    return rows.map((r) => r.tenantId);
  }

  async isMember(userId: string, tenantId: string, tx: UserServiceTx): Promise<boolean> {
    const [row] = await tx
      .select({ userId: tenantMemberships.userId })
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.tenantId, tenantId)))
      .limit(1);
    return row !== undefined;
  }

  async addMembership(userId: string, tenantId: string, tx: UserServiceTx): Promise<void> {
    await tx.insert(tenantMemberships).values({ userId, tenantId }).onConflictDoNothing();
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
