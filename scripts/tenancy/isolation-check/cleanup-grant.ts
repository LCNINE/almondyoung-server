import { waitFor } from './http';
import { messageOf, tokenClaimsOf, type Probe } from './judge';

/**
 * 격리 실측(--write)이 만든 «[개통 점검]» 상품을 지우는 역할. 테넌트 2 직원 역할(`TENANT_STAFF_ROLE`)엔 삭제가 없고, 역할은
 * 전역이라 거기에 더하면 모든 테넌트 직원이 지우게 된다 — 그래서 점검 계정 한 명에게만, 지우는 동안만 준다.
 * 부여 API 의 기한은 날짜뿐이라(그날 자정 KST) 오늘로 걸고, 지운 뒤 테넌트 2 의 부여에서 바로 회수한다.
 * 화면 실측은 이 부여 전에 끝난다(점검 계정이 직원과 같은 권한으로 화면을 본다).
 */
export const ISOLATION_CHECK_CLEANUP_ROLE = {
  name: 'isolation_check_cleanup',
  displayName: '격리 실측 정리',
  description: '격리 실측(--write)이 만든 «[개통 점검]» 상품 지우기 — 점검 계정에 그날까지만 준다',
  permissions: ['catalog.product.read', 'catalog.product.delete'],
} as const;

export interface CleanupGrantPorts {
  findRole(name: string): Promise<{ roleId: string; version: number; permissions: string[] } | null>;
  createRole(input: {
    name: string;
    displayName: string;
    description: string;
    permissions: string[];
    tenantId: string;
  }): Promise<void>;
  replaceRolePermissions(roleId: string, permissions: string[], version: number): Promise<void>;
  /** `untilDate` = `YYYY-MM-DD`, 그날 자정(KST)에 끝난다 */
  grantUntil(roleId: string, tenantId: string, userId: string, untilDate: string): Promise<void>;
  revoke(roleId: string, tenantId: string, userId: string): Promise<void>;
  /** 토큰의 `roles` 는 발급 때의 부여다 — 부여·회수 «뒤»에 새로 받아야 바뀐 것이 보인다 */
  signInTenantTwo(): Promise<string>;
  deleteProduct(token: string, masterId: string): Promise<Probe>;
  now(): Date;
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k) => b.includes(k));
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const kstDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const holdsRole = (token: string) => {
  const roles = tokenClaimsOf(token).roles;
  return Array.isArray(roles) && roles.includes(ISOLATION_CHECK_CLEANUP_ROLE.name);
};

async function ensureRole(ports: CleanupGrantPorts, tenantId: string): Promise<string> {
  const want = [...ISOLATION_CHECK_CLEANUP_ROLE.permissions];
  let role = await ports.findRole(ISOLATION_CHECK_CLEANUP_ROLE.name);
  if (!role) {
    await ports.createRole({ ...ISOLATION_CHECK_CLEANUP_ROLE, permissions: want, tenantId });
    role = await ports.findRole(ISOLATION_CHECK_CLEANUP_ROLE.name);
    if (!role) throw new Error(`역할 ${ISOLATION_CHECK_CLEANUP_ROLE.name} 을 만들었는데 안 보인다`);
  }
  if (!sameSet(role.permissions, want)) await ports.replaceRolePermissions(role.roleId, want, role.version);
  return role.roleId;
}

/**
 * 부여(오늘까지) → 새 토큰으로 API 삭제 → 테넌트 2 에서 회수 → 새 토큰으로 회수 확인. 회수는 언제나 한다. 돌려주는 것은
 * 못 지운 것·못 거둔 것의 설명 — 진입점이 실행 끝에 그대로 출력한다. 새로 만든 역할은 core 권한 캐시(30초 주기)에 늦게
 * 들어와 처음엔 403 일 수 있다.
 */
export async function removeProductsWithTemporaryGrant(
  ports: CleanupGrantPorts,
  opts: {
    readonly tenantTwoId: string;
    readonly masterIds: readonly string[];
    readonly permissionWaitMs: number;
    readonly retryEveryMs?: number;
  },
): Promise<string[]> {
  if (opts.masterIds.length === 0) return [];
  const all = (why: string) => [`상품 ${opts.masterIds.join(', ')} (${why})`];
  const until = kstDate(ports.now());
  let roleId: string;
  let userId: string;
  try {
    roleId = await ensureRole(ports, opts.tenantTwoId);
    const sub = tokenClaimsOf(await ports.signInTenantTwo()).sub;
    if (typeof sub !== 'string') throw new Error('점검 계정 토큰에 sub 가 없다');
    userId = sub;
    await ports.grantUntil(roleId, opts.tenantTwoId, userId, until);
  } catch (e) {
    return all(`삭제 역할 부여 실패: ${errorText(e)}`);
  }

  const left: string[] = [];
  let tried = 0;
  try {
    const token = await ports.signInTenantTwo();
    if (!holdsRole(token)) {
      left.push(...all(`부여했는데 토큰에 ${ISOLATION_CHECK_CLEANUP_ROLE.name} 이 없다 — 테넌트 2 부여인지 확인`));
      tried = opts.masterIds.length;
    }
    for (const id of opts.masterIds.slice(tried)) {
      const r = await waitFor(
        () => ports.deleteProduct(token, id),
        (p) => p.status !== 403,
        opts.permissionWaitMs,
        opts.retryEveryMs,
      );
      tried++;
      if (r.status < 200 || r.status >= 300) left.push(`상품 ${id} (${r.status} «${messageOf(r.body)}»)`);
    }
  } catch (e) {
    // 던진 그 상품부터 뒤는 지워졌는지 모른다 — 남은 것으로 적는다
    left.push(`상품 ${opts.masterIds.slice(tried).join(', ')} (${errorText(e)})`);
  } finally {
    const notRevoked = (why: string) =>
      `역할 ${ISOLATION_CHECK_CLEANUP_ROLE.name} 회수 안 됨${why} — 점검 계정이 ${until} 자정(KST)까지 상품을 지울 수 있다`;
    try {
      await ports.revoke(roleId, opts.tenantTwoId, userId);
      // 회수 API 가 테넌트를 무시하면(옛 user-service) 요청자의 테넌트 1 부여만 보고 2xx 로 끝난다 — 토큰으로 확인한다
      if (holdsRole(await ports.signInTenantTwo()))
        left.push(notRevoked(' (새 토큰에 아직 있다 — lcnine-auth 배포 확인)'));
    } catch (e) {
      left.push(notRevoked(` «${errorText(e)}»`));
    }
  }
  return left;
}
