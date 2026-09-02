import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import jwt from 'jsonwebtoken';
import {
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from '@medusajs/core-flows';
import { PROMOTION_META_MODULE } from '../../src/modules/promotion-meta';

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
    let storeHeaders: { headers: Record<string, string> };
    let customerId: string;
    let regionId = '';
    let salesChannelId = '';
    let pk = '';
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

    // 만료·사용의 정본은 Task 4(#488 G1~G4) 이후 grant 다 — 관리자 수동 발급 라우트는 더
    // 이상 링크의 `data`(expires_at/issued_via/used_at/order_id)를 채우지 않는다. T1·T2 는
    // 그 값을 링크가 아니라 grant 에서 읽도록 옮겼다(T3 는 링크 모듈 자체의 의미론을
    // 검사하는 테스트라 영향 없음 — 그대로 둔다).
    //
    // 🔴 T4(카트 게이트의 인스턴스 만료)는 Task 5(#488 G5~G7)로 한 번 더 옮겨간다 — 게이트가
    // 이제 링크 행이 아니라 grant 로 「발급된 장」을 판정하므로, T4 도 grant 로 만든다. T5(public
    // 쿠폰)는 애초에 발급 개념이 없어 grant 와 무관하다 — 정책 `ends_at` 만 본다(영향 없음).
    const metaService = () => getContainer().resolve(PROMOTION_META_MODULE) as any;

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

      // T4·T5 는 /store/carts 를 때리므로 지역·판매채널·퍼블리셔블 키가 필요하다
      // (coupon-cart.spec.ts:36-90 과 같은 모양). 국가 코드는 리전에 한 번만 배정할 수 있어
      // beforeEach 가 매번 돌아도 이 픽스처는 최초 한 번만 만든다.
      if (!regionId) {
        const { result: scRes } = await createSalesChannelsWorkflow(container).run({
          input: { salesChannelsData: [{ name: 'Validity SC' }] },
        });
        salesChannelId = scRes[0].id;

        const { result: regionRes } = await createRegionsWorkflow(container).run({
          input: { regions: [{ name: 'KR', currency_code: 'krw', countries: ['kr'] }] },
        });
        regionId = regionRes[0].id;

        const { result: keyRes } = await createApiKeysWorkflow(container).run({
          input: { api_keys: [{ title: 'pk-validity', type: 'publishable', created_by: user.id }] },
        });
        pk = keyRes[0].token;
        await linkSalesChannelsToApiKeyWorkflow(container).run({
          input: { id: keyRes[0].id, add: [salesChannelId] },
        });
      }

      storeHeaders = {
        headers: {
          'x-publishable-api-key': pk,
          authorization: `Bearer ${jwt.sign(
            {
              actor_id: customerId,
              actor_type: 'customer',
              auth_identity_id: 'c',
              app_metadata: { customer_id: customerId },
            },
            secret,
          )}`,
        },
      };
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
        // 🔴 (a) 계약 변경 (#488 Task 4, task-4-report.md 「6건 분류표」 항목 4): 이전엔 링크의
        // `data.expires_at`/`data.issued_via` 를 검사했다. 발급이 인스턴스 만료를 박는다는
        // «무엇»은 그대로지만 그 저장 위치가 grant 로 옮겨갔다 — 관리자 수동 발급 라우트는
        // 더 이상 링크에 `data:` 를 싣지 않는다(만료·사용의 정본이 grant 이므로).
        const id = await createPromo(`MANUALREL${seq}`, {
          visibility: 'assigned_only',
          validity_days: 30,
        });
        const before = Date.now();
        await api.post(
          `/admin/customers/${customerId}/promotions`,
          { promotion_ids: [id], submit_id: `manualrel-${seq}` },
          adminHeaders,
        );

        const [grant] = await metaService().listGrantsForPromotion(id);
        expect(grant.issued_via).toEqual('admin_manual');
        const delta = new Date(grant.expires_at).getTime() - before;
        expect(delta).toBeGreaterThan(29.9 * 24 * 3600 * 1000);
        expect(delta).toBeLessThan(30.1 * 24 * 3600 * 1000);
      });

      it('관리자 수동 발급 — validity_days 가 없으면 정책의 ends_at 이 박힌다', async () => {
        // 절대 미래시각 하드코딩 금지(I3, 2026-08-31 최종 리뷰) — 발급 창이 지나면 이 테스트가
        // "expired" skip 으로 죽어 "만료 로직이 바뀌었다"가 아니라 "스위트가 깨졌다"로 보인다.
        // 🔴 (a) 계약 변경 — 위와 같은 이유로 링크 대신 grant 를 읽는다.
        const endsAt = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
        const id = await createPromo(`MANUALABS${seq}`, {
          visibility: 'assigned_only',
          ends_at: endsAt,
        });
        await api.post(
          `/admin/customers/${customerId}/promotions`,
          { promotion_ids: [id], submit_id: `manualabs-${seq}` },
          adminHeaders,
        );

        const [grant] = await metaService().listGrantsForPromotion(id);
        expect(new Date(grant.expires_at).toISOString()).toEqual(endsAt);
      });

      it('둘 다 없으면 무기한(NULL)으로 박힌다', async () => {
        const id = await createPromo(`MANUALINF${seq}`, { visibility: 'assigned_only' });
        await api.post(
          `/admin/customers/${customerId}/promotions`,
          { promotion_ids: [id], submit_id: `manualinf-${seq}` },
          adminHeaders,
        );

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
          { promotion_ids: [id], submit_id: `windowend-${seq}` },
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
          { promotion_ids: [id], submit_id: `windowstart-${seq}` },
          adminHeaders,
        );
        expect(res.data.skipped.find((s: any) => s.promotion_id === id)?.reason).toEqual('not_started');
      });
    });

    // 🔴 (#488 Task 4 리뷰 Important #2, 2026-09-02 재분류): 여기 있던 'T2: 회수 후 재발급이
    // 옛 사용기록을 지운다' 는 원래 `Link.create` 의 upsert 의미론에 특유한 결함(회수 후
    // 되살아난 행이 낡은 used_at/order_id 를 끌고 오는 것)을 지켰다. `issueGrant` 는 매번
    // `used_at: null, order_id: null` 을 하드코딩한 순수 INSERT 라 그 결함이 재현될 코드
    // 경로가 없고, 이 describe 의 "회수" 단계도 DELETE 가 `coupon_grant` 를 안 건드리니
    // (Task 7 스코프) 장식이었다 — 처음 세션에서 grant 기반으로 재작성했더니 "제목이
    // 주장하는 것보다 덜 검사하는", 사실상 깨질 수 없는 테스트가 됐다(리뷰 발견).
    // 삭제한다 — 이 불변식(새로 만든 grant 는 used_at/order_id 가 비어 있다)은
    // `issueGrant` 의 INSERT 구조 자체가 구조적으로 보장하고, 실제 커버리지는:
    //   - `apps/medusa/src/modules/promotion-meta/__tests__/service.integration.spec.ts`
    //     (`issueGrant 는 같은 issue_key 두 번째에 duplicate 를 돌려준다`, 라인 177~ 및
    //     `restoreGrantsByOrder` 스펙들)이 이미 `issueGrant`/grant 행의 `used_at` 상태를
    //     module 레벨에서 직접 검증한다 — 이 HTTP 스펙보다 더 정확하고 더 빠르다.
    //   - `coupon-grant.spec.ts` G1·G2 가 관리자 수동 발급이 매번 독립된 새 grant 행을
    //     만든다는 것(=append-only, 되살아나지 않음)을 이미 직접 덮는다.
    // 회수→재발급의 «진짜» 계약(회수가 실제로 grant 를 되돌리는 것)은 Task 7 이
    // `revokeGrants` 를 DELETE 라우트에 연결한 뒤에야 검사할 수 있다 — 그때는 지금
    // 의도적으로 빨간 채로 남긴 coupon-admin.spec.ts 의 'RE-ISSUES after revoke' 가 그
    // 자리를 채운다.

    describe('T4·T5: 만료 강제', () => {
      it('T5 🔴 public 쿠폰도 meta.ends_at 만료면 카트에 못 붙는다', async () => {
        await createPromo(`PUBEXP${seq}`, {
          visibility: 'public',
          ends_at: '2000-01-01T00:00:00.000Z',
        });
        await expect(
          api.post('/store/carts', { region_id: regionId, promo_codes: [`PUBEXP${seq}`] }, storeHeaders),
        ).rejects.toMatchObject({ response: { status: 400, data: { code: 'COUPON_EXPIRED' } } });
      });

      it('T5 대조군: 만료되지 않은 public 쿠폰은 붙는다', async () => {
        await createPromo(`PUBOK${seq}`, {
          visibility: 'public',
          ends_at: '2999-01-01T00:00:00.000Z',
        });
        const res = await api.post(
          '/store/carts',
          { region_id: regionId, promo_codes: [`PUBOK${seq}`] },
          storeHeaders,
        );
        expect(res.status).toEqual(200);
      });

      it('T4 발급된 쿠폰은 «장»의 만료가 기준이다 — 정책 창이 지나도 산다', async () => {
        const id = await createPromo(`ISSUEDLIVE${seq}`, {
          visibility: 'assigned_only',
          ends_at: '2000-01-01T00:00:00.000Z',
        });
        await metaService().issueGrant({
          promotion_id: id, customer_id: customerId, issue_key: `issuedlive_${seq}`,
          issued_via: 'admin_manual', expires_at: new Date('2999-01-01T00:00:00.000Z'), now: new Date(),
        });

        const res = await api.post(
          '/store/carts',
          { region_id: regionId, promo_codes: [`ISSUEDLIVE${seq}`] },
          storeHeaders,
        );
        expect(res.status).toEqual(200);
      });

      it('T4 발급된 쿠폰의 장 만료가 지났으면 못 붙는다 — 정책 창이 열려 있어도', async () => {
        const id = await createPromo(`ISSUEDDEAD${seq}`, {
          visibility: 'assigned_only',
          ends_at: '2999-01-01T00:00:00.000Z',
        });
        await metaService().issueGrant({
          promotion_id: id, customer_id: customerId, issue_key: `issueddead_${seq}`,
          issued_via: 'admin_manual', expires_at: new Date('2000-01-01T00:00:00.000Z'), now: new Date(),
        });

        await expect(
          api.post('/store/carts', { region_id: regionId, promo_codes: [`ISSUEDDEAD${seq}`] }, storeHeaders),
        ).rejects.toMatchObject({ response: { status: 400, data: { code: 'COUPON_EXPIRED' } } });
      });

      // 🔴 2026-09-02 전체 리뷰 Critical: `isUsable(instance, policy, now)` → `hasUsableGrant`
      // 로 옮기면서 **정책 `starts_at` 검사가 장 보유자에게서 사라졌다**. `hasUsableGrant` 는
      // 장의 만료/소모만 알고 정책은 모르는데, 게이트가 «장이 있으면 장, 없으면 정책» 으로
      // 분기하면서 정책 검사가 no-grant 가지에만 남았기 때문이다.
      //
      // 이 테스트가 없으면 안 잡힌다 — coupon-store.spec.ts 의 'ASSIGNED_NS' 는 `linkCustomer`
      // 만 부르고 **grant 를 안 만들어** no-grant 폴백을 타므로 이 결함에 공허하게 통과한다.
      // 그래서 여기서는 반드시 살아있는 장을 심는다.
      //
      // 도달 경로 둘: (a) 관리자가 미래 시작 쿠폰을 «강제 발급» (발급 실패 직후 다이얼로그가
      // 그 버튼을 준다), (b) 운영 중인 쿠폰의 `starts_at` 을 뒤로 미룸 — (b)는 강제 발급조차
      // 필요 없이 기존 보유자 전원이 해당된다.
      it('T4 🔴 장을 가졌어도 정책 starts_at 이 미래면 못 붙는다 (COUPON_NOT_STARTED)', async () => {
        const id = await createPromo(`GRANTNS${seq}`, {
          visibility: 'assigned_only',
          starts_at: '2999-01-01T00:00:00.000Z',
        });
        // 장 자체는 완전히 «살아있다» — 미사용이고 무기한이다. 거절 사유는 오직 정책 시작이다.
        await metaService().issueGrant({
          promotion_id: id, customer_id: customerId, issue_key: `grantns_${seq}`,
          issued_via: 'admin_manual', expires_at: null, now: new Date(),
        });

        await expect(
          api.post('/store/carts', { region_id: regionId, promo_codes: [`GRANTNS${seq}`] }, storeHeaders),
        ).rejects.toMatchObject({ response: { status: 400, data: { code: 'COUPON_NOT_STARTED' } } });
      });

      // 같은 결함의 마이페이지 쪽 얼굴 — 표시와 판정이 갈리면 안 된다. 카트가 거절하는 쿠폰이
      // "사용 가능" 목록에 떠 있으면 고객은 붙지 않는 쿠폰을 계속 누른다.
      it('T4 🔴 시작 전 쿠폰은 장이 있어도 마이페이지 «사용 가능» 에 안 뜬다', async () => {
        const id = await createPromo(`GRANTNSME${seq}`, {
          visibility: 'assigned_only',
          starts_at: '2999-01-01T00:00:00.000Z',
        });
        await metaService().issueGrant({
          promotion_id: id, customer_id: customerId, issue_key: `grantnsme_${seq}`,
          issued_via: 'admin_manual', expires_at: null, now: new Date(),
        });
        const link = getContainer().resolve(ContainerRegistrationKeys.LINK) as any;
        await link.create([{
          [Modules.CUSTOMER]: { customer_id: customerId },
          [Modules.PROMOTION]: { promotion_id: id },
        }]);

        const res = await api.get('/store/customers/me/promotions', storeHeaders);
        expect(res.data.promotions.map((p: any) => p.code)).not.toContain(`GRANTNSME${seq}`);
      });

      // 대조군 — 시작 시각이 지난 쿠폰은 장으로 정상 통과한다. 위 두 개가 "전부 거절"로
      // 공허하게 통과하는 것을 막는다.
      it('T4 대조군: 시작 시각이 지난 쿠폰은 장으로 붙는다', async () => {
        const id = await createPromo(`GRANTSTARTED${seq}`, {
          visibility: 'assigned_only',
          starts_at: '2000-01-01T00:00:00.000Z',
        });
        await metaService().issueGrant({
          promotion_id: id, customer_id: customerId, issue_key: `grantstarted_${seq}`,
          issued_via: 'admin_manual', expires_at: null, now: new Date(),
        });

        const res = await api.post(
          '/store/carts',
          { region_id: regionId, promo_codes: [`GRANTSTARTED${seq}`] },
          storeHeaders,
        );
        expect(res.status).toEqual(200);
      });

      it('T4 /store/carts/:id/promotions 경로도 막는다', async () => {
        await createPromo(`PROMOPATH${seq}`, {
          visibility: 'public',
          ends_at: '2000-01-01T00:00:00.000Z',
        });
        const cart = await api.post('/store/carts', { region_id: regionId }, storeHeaders);
        await expect(
          api.post(
            `/store/carts/${cart.data.cart.id}/promotions`,
            { promo_codes: [`PROMOPATH${seq}`] },
            storeHeaders,
          ),
        ).rejects.toMatchObject({ response: { status: 400, data: { code: 'COUPON_EXPIRED' } } });
      });
    });
  },
});
