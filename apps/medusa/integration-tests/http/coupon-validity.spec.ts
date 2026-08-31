import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import jwt from 'jsonwebtoken';

jest.setTimeout(180 * 1000);

/**
 * 유효기간 두 축 (#488 P4+P5) 의 통합 스펙.
 * T1~T6 은 플랜 문서의 번호와 같다.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: { headers: Record<string, string> };
    let customerId: string;
    let seq = 0;

    const linkModule = () =>
      (getContainer().resolve(ContainerRegistrationKeys.LINK) as any).getLinkModule(
        Modules.CUSTOMER,
        'customer_id',
        Modules.PROMOTION,
        'promotion_id',
      );

    const listLinks = (promotionId: string) =>
      linkModule().list(
        { promotion_id: promotionId },
        { select: ['customer_id', 'promotion_id', 'expires_at', 'used_at', 'order_id', 'issued_via'] },
      ) as Promise<any[]>;

    beforeEach(async () => {
      seq++;
      const container = getContainer();
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const secret = config.projectConfig.http.jwtSecret;
      const userModule = container.resolve(Modules.USER);
      const [user] = await userModule.createUsers([{ email: `admin${seq}@validity.test` }]);
      adminHeaders = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'a', app_metadata: { user_id: user.id } },
            secret,
          )}`,
        },
      };
      const customerModule = container.resolve(Modules.CUSTOMER);
      const [cust] = await customerModule.createCustomers([{ email: `buyer${seq}@validity.test` }]);
      customerId = cust.id;
    });

    const createPromo = async (code: string, additional_data: Record<string, unknown>) => {
      const res = await api.post(
        '/admin/promotions',
        {
          code,
          type: 'standard',
          is_automatic: false,
          status: 'active',
          application_method: { type: 'percentage', value: 10, target_type: 'order', currency_code: 'krw' },
          additional_data,
        },
        adminHeaders,
      );
      return res.data.promotion.id as string;
    };

    describe('T3: Link.create 의 의미론', () => {
      it('같은 쌍을 두 번 create 해도 행은 하나이고 예외가 나지 않는다 (upsert)', async () => {
        const id = await createPromo(`UPSERT${seq}`, { visibility: 'assigned_only' });
        const link = getContainer().resolve(ContainerRegistrationKeys.LINK) as any;
        const pair = {
          [Modules.CUSTOMER]: { customer_id: customerId },
          [Modules.PROMOTION]: { promotion_id: id },
        };

        await link.create([pair]);
        await expect(link.create([pair])).resolves.toBeDefined();

        const rows = await listLinks(id);
        expect(rows).toHaveLength(1);
      });

      it('data 로 준 extraColumns 가 실제로 저장되고, 재create 가 그것을 덮는다', async () => {
        const id = await createPromo(`EXTRA${seq}`, { visibility: 'assigned_only' });
        const link = getContainer().resolve(ContainerRegistrationKeys.LINK) as any;
        const base = {
          [Modules.CUSTOMER]: { customer_id: customerId },
          [Modules.PROMOTION]: { promotion_id: id },
        };

        await link.create([{
          ...base,
          data: {
            expires_at: new Date('2026-12-31T00:00:00.000Z'),
            issued_via: 'admin_manual',
            used_at: null,
            order_id: null,
          },
        }]);
        const [first] = await listLinks(id);
        expect(new Date(first.expires_at).toISOString()).toEqual('2026-12-31T00:00:00.000Z');
        expect(first.issued_via).toEqual('admin_manual');

        await link.create([{
          ...base,
          data: {
            expires_at: new Date('2027-01-31T00:00:00.000Z'),
            issued_via: 'customer_claim',
            used_at: null,
            order_id: null,
          },
        }]);
        const rows = await listLinks(id);
        expect(rows).toHaveLength(1);
        expect(new Date(rows[0].expires_at).toISOString()).toEqual('2027-01-31T00:00:00.000Z');
        expect(rows[0].issued_via).toEqual('customer_claim');
      });

      it('dismiss 후 create 는 같은 행을 되살린다 — 옛 extraColumns 가 남는다', async () => {
        const id = await createPromo(`REVIVE${seq}`, { visibility: 'assigned_only' });
        const link = getContainer().resolve(ContainerRegistrationKeys.LINK) as any;
        const base = {
          [Modules.CUSTOMER]: { customer_id: customerId },
          [Modules.PROMOTION]: { promotion_id: id },
        };

        await link.create([{ ...base, data: { used_at: new Date(), order_id: 'order_old' } }]);
        await link.dismiss([base]);
        // data 없이 되살리면 옛 값이 그대로 남는다 — 그래서 발급 경로가 네 필드를 명시한다
        await link.create([base]);

        const rows = await listLinks(id);
        expect(rows).toHaveLength(1);
        expect(rows[0].order_id).toEqual('order_old');
      });

      it('스칼라 필터로 한 쌍만 조회할 수 있다 (카트 게이트가 이 조회를 쓴다)', async () => {
        const id = await createPromo(`SCALAR${seq}`, { visibility: 'assigned_only' });
        const link = getContainer().resolve(ContainerRegistrationKeys.LINK) as any;
        await link.create([{
          [Modules.CUSTOMER]: { customer_id: customerId },
          [Modules.PROMOTION]: { promotion_id: id },
          data: { issued_via: 'admin_manual' },
        }]);

        const rows = (await linkModule().list(
          { customer_id: customerId, promotion_id: id },
          { select: ['customer_id', 'promotion_id', 'issued_via'] },
        )) as any[];
        expect(rows).toHaveLength(1);
        expect(rows[0].issued_via).toEqual('admin_manual');
      });
    });

    describe('T1: 발급이 인스턴스 만료를 박는다', () => {
      it('관리자 수동 발급 — validity_days 가 발급일 + N일로 박힌다', async () => {
        const id = await createPromo(`MANUALREL${seq}`, {
          visibility: 'assigned_only',
          validity_days: 30,
        });
        const before = Date.now();
        await api.post(`/admin/customers/${customerId}/promotions`, { promotion_ids: [id] }, adminHeaders);

        const [row] = await listLinks(id);
        expect(row.issued_via).toEqual('admin_manual');
        const delta = new Date(row.expires_at).getTime() - before;
        expect(delta).toBeGreaterThan(29.9 * 24 * 3600 * 1000);
        expect(delta).toBeLessThan(30.1 * 24 * 3600 * 1000);
      });

      it('관리자 수동 발급 — validity_days 가 없으면 정책의 ends_at 이 박힌다', async () => {
        const id = await createPromo(`MANUALABS${seq}`, {
          visibility: 'assigned_only',
          ends_at: '2027-06-30T00:00:00.000Z',
        });
        await api.post(`/admin/customers/${customerId}/promotions`, { promotion_ids: [id] }, adminHeaders);

        const [row] = await listLinks(id);
        expect(new Date(row.expires_at).toISOString()).toEqual('2027-06-30T00:00:00.000Z');
      });

      it('둘 다 없으면 무기한(NULL)으로 박힌다', async () => {
        const id = await createPromo(`MANUALINF${seq}`, { visibility: 'assigned_only' });
        await api.post(`/admin/customers/${customerId}/promotions`, { promotion_ids: [id] }, adminHeaders);

        const [row] = await listLinks(id);
        expect(row.expires_at).toBeNull();
      });

      it('발급 창이 지난 쿠폰은 expired 로 skip 된다 — 캠페인이 아니라 meta 가 기준이다', async () => {
        const id = await createPromo(`WINDOWEND${seq}`, {
          visibility: 'assigned_only',
          ends_at: '2000-01-01T00:00:00.000Z',
        });
        const res = await api.post(
          `/admin/customers/${customerId}/promotions`,
          { promotion_ids: [id] },
          adminHeaders,
        );
        expect(res.data.skipped.find((s: any) => s.promotion_id === id)?.reason).toEqual('expired');
        expect(await listLinks(id)).toHaveLength(0);
      });

      it('발급 창이 아직인 쿠폰은 not_started 로 skip 된다', async () => {
        const id = await createPromo(`WINDOWSTART${seq}`, {
          visibility: 'assigned_only',
          starts_at: '2999-01-01T00:00:00.000Z',
        });
        const res = await api.post(
          `/admin/customers/${customerId}/promotions`,
          { promotion_ids: [id] },
          adminHeaders,
        );
        expect(res.data.skipped.find((s: any) => s.promotion_id === id)?.reason).toEqual('not_started');
      });
    });

    describe('T2: 회수 후 재발급이 옛 사용기록을 지운다', () => {
      it('used_at·order_id 가 null 로 덮인다 (upsert 라 같은 행이 되살아나므로)', async () => {
        const id = await createPromo(`REISSUE${seq}`, { visibility: 'assigned_only', validity_days: 7 });
        const link = getContainer().resolve(ContainerRegistrationKeys.LINK) as any;

        await api.post(`/admin/customers/${customerId}/promotions`, { promotion_ids: [id] }, adminHeaders);
        // 사용된 것처럼 만든다
        await link.create([{
          [Modules.CUSTOMER]: { customer_id: customerId },
          [Modules.PROMOTION]: { promotion_id: id },
          data: { used_at: new Date(), order_id: 'order_stale' },
        }]);
        // 회수
        await api.delete(`/admin/customers/${customerId}/promotions`, {
          ...adminHeaders,
          data: { promotion_ids: [id] },
        });
        // 재발급
        await api.post(`/admin/customers/${customerId}/promotions`, { promotion_ids: [id] }, adminHeaders);

        const [row] = await listLinks(id);
        expect(row.used_at).toBeNull();
        expect(row.order_id).toBeNull();
        expect(row.expires_at).not.toBeNull();
      });
    });
  },
});
