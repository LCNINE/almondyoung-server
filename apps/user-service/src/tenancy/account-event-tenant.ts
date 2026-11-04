import { TENANT_CONTEXT_KEY } from '@app/tenancy';
import { eq } from 'drizzle-orm';
import { ClsServiceManager } from 'nestjs-cls';
import { users } from '../../database/drizzle/schema';
import type { DbTransaction } from '../commons/types';

/**
 * 계정 변경·탈퇴·휴면 전환·영구 삭제 이벤트를 «그 계정의 테넌트»로 낸다(ADR-0056 — 계정은 한 테넌트의 것).
 *
 * 봉투의 테넌트는 라이브러리가 발행 순간의 맥락(`TENANT_CONTEXT_KEY`)으로 찍는다 — 없으면 앱 설정 T. 그래서 맥락이 없는
 * 크론(휴면·영구 삭제)이나 다른 테넌트 화면의 요청에서 그대로 내면 테넌트 2 계정의 탈퇴가 테넌트 1 로 찍혀, 테넌트 1 만 섬기는
 * 서비스가 받는다. `publish` 를 계정의 테넌트를 세운 맥락 안에서 부른다.
 *
 * 바깥 맥락은 바꾸지 않는다 — 같은 요청의 다른 이벤트는 여전히 화면의 테넌트다. 중첩 맥락(`inherit`)은 얕은 복사라 그것만으로는
 * 모자란다: 키가 점 경로(`tenancy.tenantId`)라 `set` 이 부모와 함께 쓰는 안쪽 객체를 고친다. 그래서 맨 위 칸을 새 객체로 갈아 끼운 뒤
 * 세운다. 맥락이 없으면(크론) 새로 연다.
 *
 * `ClsServiceManager` 의 서비스는 `ClsModule` 이 주입하는 것과 같은 전역 인스턴스다 — 생산자마다 `ClsService` 를 주입하지 않으려고
 * 이것을 쓴다.
 */
export function inAccountTenant<T>(accountTenantId: string, publish: () => Promise<T>): Promise<T> {
  const cls = ClsServiceManager.getClsService();
  const [root] = TENANT_CONTEXT_KEY.split('.');
  return cls.run({ ifNested: 'inherit' }, () => {
    cls.set(root, { ...cls.get<object | undefined>(root) });
    cls.set(TENANT_CONTEXT_KEY, accountTenantId);
    return publish();
  });
}

/** 이벤트를 낼 계정의 테넌트. 계정이 없으면 던진다 — 없는 계정의 이벤트를 아무 테넌트로나 낼 수는 없다. */
export async function accountTenantForEvent(client: DbTransaction, userId: string): Promise<string> {
  const [account] = await client
    .select({ tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!account) throw new Error(`계정 이벤트를 낼 계정이 없다: ${userId}`);
  return account.tenantId;
}
