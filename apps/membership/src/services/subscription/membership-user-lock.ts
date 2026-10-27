import { sql } from 'drizzle-orm';
import * as schema from '../../shared/schemas/entities/schema';
import { DrizzleTransaction } from '../../shared/schemas/types';

/**
 * 같은 회원의 가입·해지·만료를 한 줄로 세운다. 트랜잭션 첫 문장으로 부른다.
 * 잠금 순서가 경로마다 달라 생기는 교착을 막고, 이용권이 아직 없을 때도 잠글 대상이 된다.
 * 트랜잭션이 끝나면 풀리며 같은 트랜잭션 안 재진입은 안전하다.
 */
export async function lockMembershipUser(tx: DrizzleTransaction, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`membership-signup:${userId}`}))`);
}

/**
 * 회원을 모르고 계약 ID 만 아는 경로용. 계약의 회원 ID 는 바뀌지 않으므로 한 문장으로 그 회원을 잠근다.
 * 계약이 없으면 잠글 행이 없어 아무 일도 하지 않는다.
 */
export async function lockMembershipUserOfContract(tx: DrizzleTransaction, contractId: string): Promise<void> {
  const c = schema.subscriptionContracts;
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('membership-signup:' || ${c.userId}::text)) from ${c} where ${c.id} = ${contractId}`,
  );
}
