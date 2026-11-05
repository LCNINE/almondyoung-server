import { sql, type SQL } from 'drizzle-orm';
import { users } from '../../database/drizzle/schema';

/**
 * 계정에 딸린 행(소셜 신원·사업자 등록)의 `tenant_id` 값 — 그 계정의 테넌트를 같은 문장 안에서 읽는다(ADR-0056).
 * 요청의 테넌트(토큰·T)를 적지 않는 이유: 관리자 화면은 다른 계정의 행을 쓰고, 이 칸은 «그 계정의 것»이어야 테넌트 안 unique 가 맞다.
 */
export function accountTenantOf(userId: string): SQL<string | null> {
  return sql<string | null>`(select ${users.tenantId} from ${users} where ${users.id} = ${userId})`;
}
