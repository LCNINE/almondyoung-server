/* eslint-disable @typescript-eslint/require-await -- 가짜 포트는 실제 포트처럼 async 로 둔다 */
import { removeProductsAsCheckMaster, type CleanupPorts } from './cleanup-products';
import type { Probe } from './judge';

const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

function fakePorts(roles: string[], deletes: Probe[] = []) {
  const calls: string[] = [];
  const ports: CleanupPorts = {
    signInTenantTwo: async () => {
      calls.push('signin');
      return jwt({ sub: 'u-check', roles });
    },
    deleteProduct: async (_token, id) => {
      calls.push(`delete ${id}`);
      return deletes.shift() ?? { status: 200, body: {} };
    },
  };
  return { ports, calls };
}

/**
 * 점검 계정은 그 테넌트의 첫 master 다(ADR-0056) — 실측이 만든 «[개통 점검]» 상품을 자기 토큰으로 지운다. 예전처럼 운영자가
 * 삭제 역할을 잠깐 주고 거두지 않는다(운영자가 다른 테넌트에 부여하는 길은 없다).
 */
describe('removeProductsAsCheckMaster', () => {
  it('점검 master 의 토큰으로 지우고, 다 지웠으면 남은 것이 없다', async () => {
    const { ports, calls } = fakePorts(['master']);
    expect(await removeProductsAsCheckMaster(ports, ['m1', 'm2'])).toEqual([]);
    expect(calls).toEqual(['signin', 'delete m1', 'delete m2']);
  });

  it('지울 것이 없으면 로그인도 하지 않는다', async () => {
    const { ports, calls } = fakePorts(['master']);
    expect(await removeProductsAsCheckMaster(ports, [])).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('점검 계정이 master 가 아니면 지우지 않고, 다시 만들 길을 남긴다', async () => {
    const { ports, calls } = fakePorts(['warehouse_catalog_staff']);
    const left = await removeProductsAsCheckMaster(ports, ['m1']);
    expect(calls).toEqual(['signin']);
    expect(left).toEqual([expect.stringMatching(/m1.*master 가 아니다.*tenant:create/)]);
  });

  it('못 지운 상품은 상태·문구와 함께 남긴다', async () => {
    const { ports } = fakePorts(
      ['master'],
      [
        { status: 200, body: {} },
        { status: 500, body: { message: '실패' } },
      ],
    );
    expect(await removeProductsAsCheckMaster(ports, ['m1', 'm2'])).toEqual(['상품 m2 (500 «실패»)']);
  });

  it('로그인이 던지면 전부 남긴다', async () => {
    const ports: CleanupPorts = {
      signInTenantTwo: async () => {
        throw new Error('signin 거절 401');
      },
      deleteProduct: async () => ({ status: 200, body: {} }),
    };
    expect(await removeProductsAsCheckMaster(ports, ['m1', 'm2'])).toEqual([
      expect.stringMatching(/m1, m2.*signin 거절 401/),
    ]);
  });
});
