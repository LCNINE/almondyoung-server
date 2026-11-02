/* eslint-disable @typescript-eslint/require-await -- 가짜 포트는 실제 포트처럼 async 로 둔다 */
import {
  ISOLATION_CHECK_CLEANUP_ROLE,
  removeProductsWithTemporaryGrant,
  type CleanupGrantPorts,
} from './cleanup-grant';
import type { Probe } from './judge';

// 2026-11-02 21:00 KST
const NOW = new Date('2026-11-02T12:00:00Z');
const ROLE = ISOLATION_CHECK_CLEANUP_ROLE.name;
const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

function fakePorts(over: Partial<CleanupGrantPorts> = {}) {
  const calls: string[] = [];
  const deletes: Probe[] = [];
  let granted = false;
  const ports: CleanupGrantPorts = {
    findRole: async () => ({ roleId: 'r1', version: 1, permissions: [...ISOLATION_CHECK_CLEANUP_ROLE.permissions] }),
    createRole: async (input) => void calls.push(`create ${input.name} @${input.tenantId}`),
    replaceRolePermissions: async (roleId) => void calls.push(`replace ${roleId}`),
    grantUntil: async (roleId, tenantId, userId, date) => {
      granted = true;
      calls.push(`grant ${roleId} @${tenantId} ${userId} until ${date}`);
    },
    revoke: async (roleId, tenantId, userId) => {
      granted = false;
      calls.push(`revoke ${roleId} @${tenantId} ${userId}`);
    },
    signInTenantTwo: async () => {
      calls.push('signin');
      return jwt({ sub: 'u-check', roles: granted ? ['warehouse_catalog_staff', ROLE] : ['warehouse_catalog_staff'] });
    },
    deleteProduct: async (_token, id) => {
      calls.push(`delete ${id}`);
      return deletes.shift() ?? { status: 200, body: {} };
    },
    now: () => NOW,
    ...over,
  };
  return { ports, calls, deletes };
}

const opts = { tenantTwoId: '2', permissionWaitMs: 50, retryEveryMs: 1 };

describe('removeProductsWithTemporaryGrant — 점검 계정에만 오늘까지 삭제 역할을 줬다 테넌트 2 에서 회수한다', () => {
  it('부여(오늘 KST 까지) → 새 토큰으로 지우기 → 회수 → 새 토큰에 역할이 없음을 확인', async () => {
    const { ports, calls } = fakePorts();
    const left = await removeProductsWithTemporaryGrant(ports, { ...opts, masterIds: ['m1', 'm2'] });
    expect(left).toEqual([]);
    expect(calls).toEqual([
      'signin',
      'grant r1 @2 u-check until 2026-11-02',
      'signin',
      'delete m1',
      'delete m2',
      'revoke r1 @2 u-check',
      'signin',
    ]);
  });

  it('KST 날짜로 기한을 정한다(UTC 로는 아직 전날이어도)', async () => {
    const { ports, calls } = fakePorts({ now: () => new Date('2026-11-02T16:30:00Z') }); // 11-03 01:30 KST
    await removeProductsWithTemporaryGrant(ports, { ...opts, masterIds: ['m1'] });
    expect(calls).toContain('grant r1 @2 u-check until 2026-11-03');
  });

  it('권한 캐시가 늦어 403 이면 기다렸다 다시 지운다', async () => {
    const { ports, calls, deletes } = fakePorts();
    deletes.push({ status: 403, body: { message: 'Forbidden' } }, { status: 200, body: {} });
    expect(await removeProductsWithTemporaryGrant(ports, { ...opts, masterIds: ['m1'] })).toEqual([]);
    expect(calls.filter((c) => c.startsWith('delete'))).toHaveLength(2);
  });

  it('못 지운 상품은 id·상태와 함께 남기고, 그래도 회수한다', async () => {
    const { ports, calls, deletes } = fakePorts();
    deletes.push({ status: 500, body: { message: 'boom' } });
    const left = await removeProductsWithTemporaryGrant(ports, { ...opts, masterIds: ['m1', 'm2'] });
    expect(left).toEqual(['상품 m1 (500 «boom»)']);
    expect(calls).toContain('revoke r1 @2 u-check');
  });

  it('중간에 던지면 이미 지운 상품은 빼고 남은 것으로 적고, 회수한다', async () => {
    let n = 0;
    const { ports, calls } = fakePorts({
      deleteProduct: async () => {
        if (n++ === 1) throw new Error('timeout');
        return { status: 200, body: {} };
      },
    });
    const left = await removeProductsWithTemporaryGrant(ports, { ...opts, masterIds: ['m1', 'm2', 'm3'] });
    expect(left).toEqual(['상품 m2, m3 (timeout)']);
    expect(calls).toContain('revoke r1 @2 u-check');
  });

  it('부여 뒤 토큰에 역할이 안 실리면 지우지 않고 회수한다', async () => {
    const { ports, calls } = fakePorts({ grantUntil: async () => void calls.push('grant (무시됨)') });
    const left = await removeProductsWithTemporaryGrant(ports, { ...opts, masterIds: ['m1'] });
    expect(left).toEqual([expect.stringMatching(/^상품 m1 \(부여했는데 토큰에 isolation_check_cleanup 이 없다/)]);
    expect(calls.filter((c) => c.startsWith('delete'))).toEqual([]);
    expect(calls).toContain('revoke r1 @2 u-check');
  });

  it('회수 뒤에도 새 토큰에 역할이 있으면(옛 user-service 는 테넌트를 무시한다) 자정에 끝난다고 적는다', async () => {
    const { ports } = fakePorts({ revoke: async () => undefined });
    const left = await removeProductsWithTemporaryGrant(ports, { ...opts, masterIds: ['m1'] });
    expect(left).toEqual([expect.stringMatching(/isolation_check_cleanup 회수 안 됨.*2026-11-02 자정\(KST\)/)]);
  });

  it('회수가 던져도 자정에 끝난다고 적는다', async () => {
    const { ports } = fakePorts({
      revoke: async () => {
        throw new Error('403');
      },
    });
    const left = await removeProductsWithTemporaryGrant(ports, { ...opts, masterIds: ['m1'] });
    expect(left).toEqual([expect.stringMatching(/회수 안 됨 «403».*자정/)]);
  });

  it('부여가 실패하면 회수할 것도 없고 상품은 전부 남는다', async () => {
    const { ports, calls } = fakePorts({
      grantUntil: async () => {
        throw new Error('400 escalation');
      },
    });
    const left = await removeProductsWithTemporaryGrant(ports, { ...opts, masterIds: ['m1'] });
    expect(left).toEqual(['상품 m1 (삭제 역할 부여 실패: 400 escalation)']);
    expect(calls.some((c) => c.startsWith('revoke'))).toBe(false);
  });

  it('역할이 없으면 테넌트 2 로 만들고, 권한이 다르면 맞춘다', async () => {
    let made = false;
    const { ports, calls } = fakePorts({
      findRole: async () => (made ? { roleId: 'r1', version: 3, permissions: ['catalog.product.read'] } : null),
      createRole: async (input) => {
        made = true;
        calls.push(`create ${input.name} @${input.tenantId}`);
      },
    });
    await removeProductsWithTemporaryGrant(ports, { ...opts, masterIds: ['m1'] });
    expect(calls.slice(0, 2)).toEqual(['create isolation_check_cleanup @2', 'replace r1']);
  });

  it('지울 것이 없으면 아무것도 부여하지 않는다', async () => {
    const { ports, calls } = fakePorts();
    expect(await removeProductsWithTemporaryGrant(ports, { ...opts, masterIds: [] })).toEqual([]);
    expect(calls).toEqual([]);
  });
});
