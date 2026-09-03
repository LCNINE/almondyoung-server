import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { createPromotionsWorkflow } from '@medusajs/core-flows';
import jwt from 'jsonwebtoken';
import { PROMOTION_META_MODULE } from '../../src/modules/promotion-meta';

jest.setTimeout(120 * 1000);

medusaIntegrationTestRunner({
  inApp: true,
  // 트리거 자동발급은 프로덕션 기본 OFF(COUPON_AUTO_ISSUE_ENABLED). 이 스펙은
  // 발급 메커니즘 자체를 검증하므로 플래그를 켜고 돌린다.
  env: { COUPON_AUTO_ISSUE_ENABLED: 'true' },
  // 매 테스트 DB teardown 이 redis/BullMQ 커넥션을 닫아 async 워크플로와 레이스 →
  // teardown 을 끄고 테스트마다 고유 식별자로 격리한다.
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: { headers: Record<string, string> };
    let customerId: string;
    let seq = 0;

    // 러너가 매 테스트 후 DB teardown → beforeEach 에서 admin/customer 를 새로 만든다.
    beforeEach(async () => {
      seq++;
      const container = getContainer();
      const userModule = container.resolve(Modules.USER);
      const [user] = await userModule.createUsers([{ email: `admin${seq}@coupon.test` }]);
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const secret = config.projectConfig.http.jwtSecret;
      const token = jwt.sign(
        { actor_id: user.id, actor_type: 'user', auth_identity_id: 'test-admin-auth', app_metadata: { user_id: user.id } },
        secret,
      );
      adminHeaders = { headers: { authorization: `Bearer ${token}` } };

      const customerModule = container.resolve(Modules.CUSTOMER);
      const [cust] = await customerModule.createCustomers([
        { email: `buyer${seq}@coupon.test`, first_name: 'B', last_name: 'Uyer' },
      ]);
      customerId = cust.id;
    });

    const createPromo = async (
      code: string,
      additional_data: Record<string, unknown>,
      overrides: Record<string, unknown> = {},
    ) => {
      const res = await api.post(
        '/admin/promotions',
        {
          code,
          type: 'standard',
          is_automatic: false,
          status: 'active',
          application_method: { type: 'percentage', value: 10, target_type: 'order', currency_code: 'krw' },
          additional_data,
          ...overrides,
        },
        adminHeaders,
      );
      return res.data.promotion.id as string;
    };

    // `submit_id` 는 라우트가 요구한다(없으면 400) — 없으면 따닥이 곧 두 배 발급이라
    // 서버가 만들어 주지 않는다. 스펙에서는 호출마다 새 값을 써서 각 호출이 독립적인
    // «제출» 이 되게 한다(같은 값을 재사용하면 두 번째가 duplicate 로 떨어진다).
    let issueSeq = 0;
    const issue = (promotionIds: string[], force = false) =>
      api.post(
        `/admin/customers/${customerId}/promotions`,
        { promotion_ids: promotionIds, force, submit_id: `admin-spec-${seq}-${++issueSeq}` },
        adminHeaders,
      );

    const skipReason = (res: any, id: string) =>
      res.data.skipped.find((s: any) => s.promotion_id === id)?.reason;

    /**
     * 발급 상한을 「소진」 상태로 만든다. 옛 픽스처는 `reserveClaimSlot` 으로 카운터만 올렸지만,
     * 이제 상한의 정본은 `coupon_grant` 행이라 실제 장을 심어야 한다 (설계 결정 1).
     * `coupon_grant` 는 customer 테이블에 FK 가 없으므로 채움용 고객 id 는 실재하지 않아도 된다.
     */
    const fillClaims = async (promotionId: string, n: number) => {
      const meta = getContainer().resolve(PROMOTION_META_MODULE) as any;
      for (let i = 0; i < n; i++) {
        await meta.issueGrantWithSlot({
          promotion_id: promotionId,
          customer_id: `filler_${seq}_${i}`,
          issue_key: `${promotionId}:filler:${i}`,
          issued_via: 'admin_manual',
          expires_at: null,
          now: new Date(),
          max_claims: null, // 채우는 단계에서는 상한을 집행하지 않는다
          enforce_cap: false,
        });
      }
    };

    const createGroupWithCustomer = async (): Promise<string> => {
      const customerModule = getContainer().resolve(Modules.CUSTOMER);
      const [group] = await customerModule.createCustomerGroups([{ name: `grp${seq}` }]);
      await customerModule.addCustomerToGroup({ customer_id: customerId, customer_group_id: group.id });
      return group.id;
    };

    const groupRule = (groupId: string) => ({
      rules: [{ attribute: 'customer.groups.id', operator: 'in', values: [groupId] }],
    });

    // status draft 로 만들면 fetch-back 이 404 → active 생성 후 컨테이너로 inactive 전환
    const makeInactive = async (id: string) => {
      const promotionModule = getContainer().resolve(Modules.PROMOTION);
      await promotionModule.updatePromotions([{ id, status: 'inactive' }]);
    };

    // 이 GET 은 Task 6 부터 grant 에서 프로모션을 유도한다(customer-promotion 링크는 읽지
    // 않는다) — 이름을 `linkedPromoIds` 로 두면 낡은 전제를 코드로 남기는 셈이라 고친다.
    const grantedPromoIds = async (): Promise<string[]> => {
      const res = await api.get(`/admin/customers/${customerId}/promotions`, adminHeaders);
      return (res.data.promotions ?? []).map((p: any) => p.id);
    };

    it('creates a promotion with meta via admin API (status active + visibility)', async () => {
      const res = await api.post(
        '/admin/promotions',
        {
          code: 'SANITY10',
          type: 'standard',
          is_automatic: false,
          status: 'active',
          application_method: { type: 'percentage', value: 10, target_type: 'order', currency_code: 'krw' },
          additional_data: { visibility: 'assigned_only', name: '테스트 쿠폰' },
        },
        adminHeaders,
      );
      expect(res.status).toEqual(200);
      expect(res.data.promotion?.status).toEqual('active');
    });

    it('링크 없이 grant 만 있는 쌍도 어드민 고객 상세에 뜬다', async () => {
      const promoId = await createPromo(`ADMGRANT${seq}`, { visibility: 'assigned_only' });
      const metaService = getContainer().resolve(PROMOTION_META_MODULE) as any;
      await metaService.issueGrantWithSlot({
        promotion_id: promoId,
        customer_id: customerId,
        issue_key: `${promoId}:${customerId}:direct:1`,
        issued_via: 'admin_manual',
        expires_at: null,
        now: new Date(),
        max_claims: null,
        enforce_cap: true,
      });

      const res = await api.get(`/admin/customers/${customerId}/promotions`, adminHeaders);

      expect(res.status).toEqual(200);
      expect(res.data.promotions.map((p: any) => p.id)).toContain(promoId);
      expect(res.data.count).toEqual(1);
    });

    // grant 0건과 고객 미존재는 다른 사건이다 — customer 조회를 존재 확인용으로 남긴 이유.
    it('존재하지 않는 고객은 grant 유무와 무관하게 404', async () => {
      const err = await api
        .get(`/admin/customers/cus_does_not_exist/promotions`, adminHeaders)
        .catch((e: any) => e);
      expect(err.response.status).toEqual(404);
    });

    // grant 가 하나도 없으면 promotion id 목록도 비므로, 그 빈 배열로 `query.graph` 를
    // 부르지 않아야 한다(부르면 빈 filters.id 가 «전체 프로모션» 으로 풀릴 수 있는 함정).
    it('grant 가 0건인 고객은 200 + 빈 목록', async () => {
      const res = await api.get(`/admin/customers/${customerId}/promotions`, adminHeaders);
      expect(res.status).toEqual(200);
      expect(res.data.promotions).toEqual([]);
      expect(res.data.count).toEqual(0);
    });

    // (c) 였던 회귀는 Task 7 이 닫았다 (#488 Task 4 리뷰, task-4-report.md 「6건 분류표」
    // 항목 1). DELETE 라우트(`/admin/customers/:id/promotions`, `/admin/promotions/:id/customers`
    // 양쪽)가 이제 `revokeGrants` 로 `coupon_grant` 행을 soft-delete 하므로, 파셜 유니크
    // (`WHERE deleted_at IS NULL`)가 더 이상 회수된 행과 충돌하지 않고 4번의 `issue_key =
    // trigger:customer_registered` 재발급이 통과한다.
    it('auto-issues by trigger, is idempotent, and RE-ISSUES after revoke (P2-2 end-to-end)', async () => {
      const promoId = await createPromo('AUTO10', {
        visibility: 'assigned_only',
        auto_issue_trigger: 'customer_registered',
      });

      // 1) 트리거 발급
      const issue1 = await api.post(
        `/admin/customers/${customerId}/issue-coupons`,
        { trigger: 'customer_registered' },
        adminHeaders,
      );
      expect(issue1.data.issued.map((i: any) => i.promotion_id)).toContain(promoId);
      expect(await grantedPromoIds()).toContain(promoId);

      // 2) 재발급 시도 → 멱등(already_issued skip)
      const issue2 = await api.post(
        `/admin/customers/${customerId}/issue-coupons`,
        { trigger: 'customer_registered' },
        adminHeaders,
      );
      expect(issue2.data.skipped.map((s: any) => s.promotion_id)).toContain(promoId);
      expect(issue2.data.issued.map((i: any) => i.promotion_id)).not.toContain(promoId);

      // 3) 회수
      const revoke = await api.delete(`/admin/customers/${customerId}/promotions`, {
        ...adminHeaders,
        data: { promotion_ids: [promoId] },
      });
      expect(revoke.status).toEqual(200);
      expect(await grantedPromoIds()).not.toContain(promoId);

      // 4) 회수 후 트리거 → 재발급되어야 함 (issue-log 정리 검증, P2-2)
      const issue3 = await api.post(
        `/admin/customers/${customerId}/issue-coupons`,
        { trigger: 'customer_registered' },
        adminHeaders,
      );
      expect(issue3.data.issued.map((i: any) => i.promotion_id)).toContain(promoId);
      expect(await grantedPromoIds()).toContain(promoId);
    });

    it('manual assign is batch-resilient: invalid coupon is skipped, valid one issued (P1-3)', async () => {
      const validId = await createPromo('BATCHOK', { visibility: 'assigned_only' });
      const inactiveId = await createPromo('BATCHBAD', { visibility: 'assigned_only' });
      await makeInactive(inactiveId);

      const res = await api.post(
        `/admin/customers/${customerId}/promotions`,
        { promotion_ids: [validId, inactiveId], submit_id: `batch-resilient-${seq}` },
        adminHeaders,
      );
      expect(res.status).toEqual(200); // throw 아님
      expect(res.data.issued).toContain(validId);
      const inactiveSkip = res.data.skipped.find((s: any) => s.promotion_id === inactiveId);
      expect(inactiveSkip?.reason).toEqual('inactive');
    });

    it('force assign bypasses the inactive-status gate', async () => {
      const inactiveId = await createPromo('FORCEME', { visibility: 'assigned_only' });
      await makeInactive(inactiveId);
      const res = await issue([inactiveId], true);
      expect(res.data.issued).toContain(inactiveId);
    });

    it('skip reasons: automatic / not_started / expired / group_mismatch', async () => {
      const autoId = await createPromo('AUTOMATIC', { visibility: 'assigned_only' }, { is_automatic: true });
      const futureId = await createPromo('FUTURE', {
        visibility: 'assigned_only',
        starts_at: '2999-01-01T00:00:00.000Z',
      });
      const pastId = await createPromo('PAST', {
        visibility: 'assigned_only',
        ends_at: '2000-01-01T00:00:00.000Z',
      });
      const otherGroup = (await getContainer().resolve(Modules.CUSTOMER).createCustomerGroups([{ name: `other${seq}` }]))[0];
      const groupId = otherGroup.id;
      const restrictedId = await createPromo('RESTRICTED', { visibility: 'assigned_only' }, groupRule(groupId));

      const res = await issue([autoId, futureId, pastId, restrictedId]);
      expect(res.status).toEqual(200);
      expect(skipReason(res, autoId)).toEqual('automatic');
      expect(skipReason(res, futureId)).toEqual('not_started');
      expect(skipReason(res, pastId)).toEqual('expired');
      expect(skipReason(res, restrictedId)).toEqual('group_mismatch');
    });

    it('group rule: customer IN group is issued', async () => {
      const groupId = await createGroupWithCustomer();
      const promoId = await createPromo('INGROUP', { visibility: 'assigned_only' }, groupRule(groupId));
      const res = await issue([promoId]);
      expect(res.data.issued).toContain(promoId);
    });

    it('max_claims_exceeded once coupon_grant COUNT reaches the cap', async () => {
      const promoId = await createPromo('CAPPED', { visibility: 'claimable', max_claims: 1 });
      await fillClaims(promoId, 1); // 소진
      const res = await issue([promoId]);
      expect(skipReason(res, promoId)).toEqual('max_claims_exceeded');
    });

    it('revoke restores the grant COUNT (customers/:id/promotions path)', async () => {
      // 🔴 Task 4 (#488 G1~G4) 이전엔 이 테스트가 `isAlreadyIssued`(promotion_issue_log 기반)도
      // 같이 검사했다 — 세 발급 경로 전부가 grant 모델로 옮겨가며 그 로그에 더 이상 아무도
      // 쓰지 않는다(대체물은 `coupon_grant.issue_key` 유니크). Task 10 이 그 테이블·메서드
      // 자체를 걷어낼 예정이라 그 검사는 여기서 뺐다 — `coupon_grant` COUNT(Task 2 로
      // `issued_count` 를 대체한 상한의 정본)는 여전히 실제 동작이라 남긴다.
      const promoId = await createPromo('REVOKE1', { visibility: 'claimable', max_claims: 5 });
      await issue([promoId]);
      const metaService = getContainer().resolve(PROMOTION_META_MODULE) as any;
      expect(await metaService.countIssuedGrants(promoId)).toEqual(1);

      await api.delete(`/admin/customers/${customerId}/promotions`, { ...adminHeaders, data: { promotion_ids: [promoId] } });
      expect(await metaService.countIssuedGrants(promoId)).toEqual(0);
    });

    it('revoke via promotions/:id/customers path also restores the grant COUNT', async () => {
      // 🔴 :211 의 형제 수정과 같은 이유(#488 Task 4 리뷰 Important #1) — `isAlreadyIssued`
      // 는 세 발급 경로 전부가 `recordIssue` 를 안 부르니 항상 `false` 다. 예전엔 여기에도
      // `expect(await metaService.isAlreadyIssued(...)).toBe(false)` 가 있었는데, DELETE 가
      // 아무 일도 안 해도 통과하는(공허하게 참) 단언이라 제거한다 — grant COUNT 복원만
      // 실제로 검사되는 것이라 그것만 남긴다.
      const promoId = await createPromo('REVOKE2', { visibility: 'claimable', max_claims: 5 });
      await issue([promoId]);
      const metaService = getContainer().resolve(PROMOTION_META_MODULE) as any;

      await api.delete(`/admin/promotions/${promoId}/customers`, { ...adminHeaders, data: { customer_ids: [customerId] } });
      expect(await metaService.countIssuedGrants(promoId)).toEqual(0);
    });

    // 🔴 ADR-0034 회귀 방지. 링크를 「남은 장이 없을 때만」 걷도록 바꾸면서 `remaining === 0`
    // 하나로 판정했더니, 「쓴 장만 남았다」와 «애초에 아무 관계도 없었다»가 구별되지 않아
    // 오타로 넣은 promotion_id 까지 「제거됨」으로 응답했다.
    it('revoke reports nothing removed for a pair that never existed', async () => {
      const promoId = await createPromo('NEVERHELD', { visibility: 'claimable', max_claims: 5 });
      // 발급하지 않는다 — 장도 링크도 없는 쌍이다.

      const res = await api.delete(`/admin/customers/${customerId}/promotions`, {
        ...adminHeaders,
        data: { promotion_ids: [promoId] },
      });

      expect(res.status).toEqual(200);
      expect(res.data.promotion_ids).toEqual([]);
      expect(res.data.revoked_grants).toEqual(0);
    });

    it('revoke keeps used grants and still dismisses the link when none remain usable', async () => {
      const promoId = await createPromo('REVOKEUSED', { visibility: 'claimable', max_claims: 5 });
      await issue([promoId]);
      const metaService = getContainer().resolve(PROMOTION_META_MODULE) as any;

      // 발급된 한 장을 «사용» 상태로 만든다.
      const [grant] = await metaService.listGrantsForCustomer(customerId);
      expect(await metaService.consumeGrantIfUnused(grant.id, `order_${seq}_used`, new Date())).toBe(true);

      const res = await api.delete(`/admin/customers/${customerId}/promotions`, {
        ...adminHeaders,
        data: { promotion_ids: [promoId] },
      });

      // 회수할(미사용) 장이 없으므로 아무것도 제거되지 않았다고 보고해야 한다.
      expect(res.status).toEqual(200);
      expect(res.data.revoked_grants).toEqual(0);
      // 쓴 장은 살아 있어야 한다 — 이력이자 주문 취소 시 복원의 근거다.
      const left = await metaService.listGrantsForCustomer(customerId);
      expect(left.filter((g: any) => g.promotion_id === promoId)).toHaveLength(1);
      // 실제로 소비된 슬롯이므로 (deleted_at 이 그대로라) COUNT 도 되돌아가지 않는다.
      expect(await metaService.countIssuedGrants(promoId)).toEqual(1);
    });

    it('GET promotion exposes issued_count in metadata (P2-10)', async () => {
      const promoId = await createPromo('PROGRESS', { visibility: 'claimable', max_claims: 10 });
      await issue([promoId]);
      const res = await api.get(`/admin/promotions/${promoId}`, adminHeaders);
      expect(Number(res.data.promotion.metadata.issued_count)).toEqual(1);
      expect(Number(res.data.promotion.metadata.max_claims)).toEqual(10);
    });

    // 🔴 Task 4 (#488 G1~G4) 이전엔 여기 'DELETE promotion purges issue-logs (P3-6)' 테스트가
    // 있었다 — `promotion_issue_log`(`isAlreadyIssued`/`recordIssue`)를 직접 검사하는 테스트였다.
    // 세 발급 경로 전부가 grant 모델로 옮겨가며 그 로그에 아무도 안 쓰게 됐고, Task 10 이 그
    // 테이블·메서드 자체를 걷어낼 예정이라 대상이 사라진 테스트를 지웠다(대체물은
    // `coupon_grant.issue_key` 유니크 — 커버리지는 coupon-grant.spec.ts G1·G2 가 진다).

    it('메타 쓰기가 실패하면 프로모션이 롤백된다 (N7 — 워크플로 안으로 옮긴 이유)', async () => {
      const container = getContainer();
      const code = `ROLLBACK${seq}`;

      // HTTP validator 를 우회해 워크플로를 직접 돌린다 — 훅 안의 쓰기가 던졌을 때 앞 스텝이
      // 보상되는가만 본다. `visibility` 어휘 밖 값은 모듈 서비스 upsert 가 던진다.
      //
      // ⚠️ `.rejects.toThrow()` 를 쓰지 말 것. 워크플로 엔진을 거친 에러는 프로토타입을 잃어
      // **Error 인스턴스가 아닌 평범한 객체**로 온다(2026-08-31 실측: `instanceof Error === false`).
      // 그러면 jest 의 toThrow 가 「Received function did not throw」라는 엉뚱한 메시지로 실패해,
      // 롤백이 실제로 동작하는데도 구현 버그처럼 보인다.
      let caught: unknown = null;
      try {
        await createPromotionsWorkflow(container).run({
          input: {
            promotionsData: [
              {
                code,
                type: 'standard',
                status: 'active',
                application_method: { type: 'percentage', value: 10, target_type: 'order' },
              },
            ],
            additional_data: { visibility: 'bogus_value' },
          },
        } as any);
      } catch (e) {
        caught = e;
      }
      expect((caught as { message?: string } | null)?.message).toContain('Invalid visibility value');

      // 프로모션이 남아 있으면 안 된다. 남으면 그게 바로 «전체공개 활성 쿠폰» 이다.
      const promotionModule = container.resolve(Modules.PROMOTION);
      expect(await promotionModule.listPromotions({ code })).toHaveLength(0);
    });

    it('어휘 밖 visibility 는 400 이고 프로모션이 남지 않는다 (N7 회귀)', async () => {
      const code = `BADVIS${seq}`;
      const err = await api
        .post(
          '/admin/promotions',
          {
            code,
            type: 'standard',
            is_automatic: false,
            status: 'active',
            application_method: { type: 'percentage', value: 10, target_type: 'order' },
            additional_data: { visibility: 'bogus_value' },
          },
          adminHeaders,
        )
        .catch((e: any) => e);

      expect(err.response.status).toEqual(400);

      const promotionModule = getContainer().resolve(Modules.PROMOTION);
      expect(await promotionModule.listPromotions({ code })).toHaveLength(0);
    });

    it('상태 토글은 additional_data 없이도 200 이고 메타를 지우지 않는다', async () => {
      const id = await createPromo(`TOGGLE${seq}`, {
        visibility: 'assigned_only',
        name: '토글 대상',
      });

      const res = await api.post(`/admin/promotions/${id}`, { status: 'inactive' }, adminHeaders);
      expect(res.status).toEqual(200);

      const detail = await api.get(`/admin/promotions/${id}`, adminHeaders);
      expect(detail.data.promotion.metadata).toMatchObject({
        visibility: 'assigned_only',
        name: '토글 대상',
      });
    });

    it('유효기간 3키가 promotion_meta 에 저장되고 metadata 로 돌아온다 (Task 5)', async () => {
      const startsAt = '2026-09-01T00:00:00.000Z';
      const endsAt = '2026-09-30T00:00:00.000Z';
      const validityDays = 30;

      const promoId = await createPromo(`VALIDITY${seq}`, {
        visibility: 'claimable',
        starts_at: startsAt,
        ends_at: endsAt,
        validity_days: validityDays,
      });

      const res = await api.get(`/admin/promotions/${promoId}`, adminHeaders);
      expect(res.status).toEqual(200);
      expect(res.data.promotion.metadata).toMatchObject({
        visibility: 'claimable',
        starts_at: startsAt,
        ends_at: endsAt,
        validity_days: validityDays,
      });
    });
  },
});
