import { Logger } from '@nestjs/common';
import { TENANT_CONTEXT_KEY } from '@app/tenancy';
import { eq } from 'drizzle-orm';
import { ClsServiceManager } from 'nestjs-cls';
import { users } from '../../database/drizzle/schema';
import type { DbTransaction } from '../commons/types';

const logger = new Logger('AccountEventTenant');

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
 * `accountTenantId` 가 비면(채우기 마이그 전 DB — `migrate → deploy` 라 라이브엔 없어야 한다) 경고하고 지금 맥락 그대로 낸다. 요청이면
 * 화면의 테넌트, 크론이면 라이브러리가 앱 설정 T 로 찍는다 — 이 티켓 전과 같은 동작이다. 여기서 막지 않는 건 탈퇴·휴면을 멈추지
 * 않기 위해서다. 칸이 NOT NULL 이 되면(contract) 이 갈래는 없어진다.
 *
 * `ClsServiceManager` 의 서비스는 `ClsModule` 이 주입하는 것과 같은 전역 인스턴스다 — 생산자마다 `ClsService` 를 주입하지 않으려고
 * 이것을 쓴다.
 */
export function inAccountTenant<T>(accountTenantId: string | null | undefined, publish: () => Promise<T>): Promise<T> {
  if (!accountTenantId) {
    logger.warn('계정의 테넌트가 비어 있다 — 지금 맥락(없으면 T)으로 낸다. 계정 테넌트 채우기 마이그가 돌았는지 볼 것');
    return publish();
  }
  const cls = ClsServiceManager.getClsService();
  const [root] = TENANT_CONTEXT_KEY.split('.');
  return cls.run({ ifNested: 'inherit' }, () => {
    cls.set(root, { ...cls.get<object | undefined>(root) });
    cls.set(TENANT_CONTEXT_KEY, accountTenantId);
    return publish();
  });
}

/** 이벤트를 낼 계정의 테넌트. 행이 없거나 칸이 비면 null(`inAccountTenant` 가 경고한다). */
export async function accountTenantForEvent(client: DbTransaction, userId: string): Promise<string | null> {
  const [account] = await client
    .select({ tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return account?.tenantId ?? null;
}
