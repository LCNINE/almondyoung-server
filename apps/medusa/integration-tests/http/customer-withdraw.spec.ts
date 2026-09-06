import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import jwt from 'jsonwebtoken';
import { withdrawnEmailFor } from '../../src/workflows/customers/withdrawn-customer-fields';

jest.setTimeout(180 * 1000);

/**
 * `POST /admin/customers/by-almond-user/:almondUserId/withdraw` (#786, 스펙 §6).
 *
 * 주소·`user-service-sso` provider identity·`app_metadata.customer_id` 링크를 가진 고객을 만들고 라우트를 두 번
 * 부른다. 첫 호출 뒤 필드 치환·소프트 삭제·주소 0행·identity 0행, 둘째 호출은 `not_found`/0 — 재시도와 백필
 * 재실행이 안전하다는 증명이다. 마지막 케이스는 같은 이메일로 새 고객이 생기는지 본다(유일 제약이 풀렸는가).
 *
 * 「주소가 없는 고객」케이스는 `withdraw-customer.ts` 의 주소 삭제 호출이 빈 배열(`ids: []`)로도 안전한
 * no-op 인지를 본다 — 중첩 `when` 제거 이후 이 경로가 조건 없이 항상 실행되므로 직접 커버해야 한다.
 *
 * 「레거시 my-auth identity」케이스는 auth identity 삭제 step 의 세 소스 중 (a) `app_metadata.customer_id`,
 * (b) `user-service-sso` 의 `entity_id=userId` 와 무관하게 (c) `my-auth` 의 `entity_id=익명화 전 이메일`
 * 만으로도 독립적으로 찾아 지우는지를 본다 — 링크 없는 별도 identity 라 dedupe 대상이 아니라 합산돼야 한다.
 */
medusaIntegrationTestRunner({
  inApp: true,
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: { headers: Record<string, string> };
    let seq = 0;

    beforeEach(async () => {
      seq++;
      const container = getContainer();
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const secret = config.projectConfig.http.jwtSecret;
      const userModule = container.resolve(Modules.USER);
      const [user] = await userModule.createUsers([{ email: `admin${seq}@withdraw.test` }]);
      adminHeaders = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'a', app_metadata: { user_id: user.id } },
            secret,
          )}`,
        },
      };
    });

    /**
     * SSO 첫 로그인 뒤의 모양을 재현한다: has_account 고객 + almond_user_id + 주소(기본값) + sso identity(customer_id 링크).
     * `withAddresses: false` 는 주소를 한 번도 등록하지 않은 회원(빈 주소 목록으로 주소 삭제 step 이 no-op 이 되는 경로)을 재현한다.
     */
    const seedWithdrawableCustomer = async ({ withAddresses = true }: { withAddresses?: boolean } = {}) => {
      const container = getContainer();
      const userId = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
      const email = `member${seq}@withdraw.test`;
      const customerModule = container.resolve(Modules.CUSTOMER);
      const authModule = container.resolve(Modules.AUTH);

      const [customer] = await customerModule.createCustomers([
        {
          email,
          first_name: '홍',
          last_name: '길동',
          phone: '01012345678',
          has_account: true,
          metadata: { almond_user_id: userId, almond_login_id: `login${seq}` },
        },
      ]);
      if (withAddresses) {
        await customerModule.createCustomerAddresses([
          { customer_id: customer.id, address_1: '서울시 어딘가 1', city: '서울', country_code: 'kr', postal_code: '04524' },
          { customer_id: customer.id, address_1: '서울시 어딘가 2', city: '서울', country_code: 'kr', postal_code: '04525' },
        ]);
      }
      const [identity] = await authModule.createAuthIdentities([
        {
          app_metadata: { actor_type: 'customer', customer_id: customer.id },
          provider_identities: [
            {
              provider: 'user-service-sso',
              entity_id: userId,
              user_metadata: { email, name: '홍길동' },
              provider_metadata: { access_token: 'secret-at', refresh_token: 'secret-rt' },
            },
          ],
        },
      ]);
      return { userId, email, customer, identity };
    };

    const withdraw = (userId: string) =>
      api.post(`/admin/customers/by-almond-user/${userId}/withdraw`, {}, adminHeaders);

    it('식별정보를 치환하고 소프트 삭제하며 주소와 auth identity 를 지운다', async () => {
      const { userId, email, customer, identity } = await seedWithdrawableCustomer();
      const container = getContainer();
      const customerModule = container.resolve(Modules.CUSTOMER);
      const authModule = container.resolve(Modules.AUTH);

      const res = await withdraw(userId);

      expect(res.status).toBe(200);
      expect(res.data).toEqual({ customer: 'anonymized', auth_identities_deleted: 1 });

      const [after] = await customerModule.listCustomers({ id: customer.id }, { withDeleted: true } as any);
      expect(after.email).toBe(withdrawnEmailFor(userId));
      expect(after.first_name).toBe('탈퇴회원');
      expect(after.last_name).toBeNull();
      expect(after.phone).toBeNull();
      expect(after.deleted_at).not.toBeNull();
      expect(after.metadata).toEqual(
        expect.objectContaining({ almond_user_id: null, almond_login_id: `login${seq}`, withdrawn_at: expect.any(String) }),
      );
      expect(after.email).not.toBe(email);

      const addresses = await customerModule.listCustomerAddresses({ customer_id: customer.id });
      expect(addresses).toHaveLength(0);

      const identities = await authModule.listAuthIdentities({ id: [identity.id] });
      expect(identities).toHaveLength(0);
      const providerIdentities = await authModule.listProviderIdentities({ entity_id: userId, provider: 'user-service-sso' });
      expect(providerIdentities).toHaveLength(0);
    });

    it('레거시 my-auth identity 도 함께 지운다 — (a)/(b) 와 무관한 별도 identity 라 dedupe 가 아니라 합산이다', async () => {
      const { userId, email } = await seedWithdrawableCustomer();
      const authModule = getContainer().resolve(Modules.AUTH);
      // customer_id 링크도 없고 entity_id 도 userId 가 아닌 email 이라, source (a)/(b) 로는 절대 안 잡히고
      // 오직 source (c) — provider='my-auth', entity_id=익명화 전 이메일 — 로만 찾아진다.
      await authModule.createAuthIdentities([
        { provider_identities: [{ provider: 'my-auth', entity_id: email, user_metadata: { email } }] },
      ]);

      const res = await withdraw(userId);

      expect(res.status).toBe(200);
      expect(res.data).toEqual({ customer: 'anonymized', auth_identities_deleted: 2 });

      expect(await authModule.listProviderIdentities({ entity_id: email, provider: 'my-auth' })).toHaveLength(0);
      expect(await authModule.listProviderIdentities({ entity_id: userId, provider: 'user-service-sso' })).toHaveLength(0);
    });

    it('주소가 없는 고객도 익명화·소프트삭제된다 — 빈 주소 목록으로 주소 삭제 step 이 no-op 이다', async () => {
      const { userId, customer } = await seedWithdrawableCustomer({ withAddresses: false });
      const customerModule = getContainer().resolve(Modules.CUSTOMER);

      const res = await withdraw(userId);

      expect(res.status).toBe(200);
      expect(res.data).toEqual({ customer: 'anonymized', auth_identities_deleted: 1 });

      const [after] = await customerModule.listCustomers({ id: customer.id }, { withDeleted: true } as any);
      expect(after.email).toBe(withdrawnEmailFor(userId));
      expect(after.deleted_at).not.toBeNull();
    });

    it('두 번째 호출은 not_found / 0 으로 200 — 재시도·백필 재실행이 안전하다', async () => {
      const { userId } = await seedWithdrawableCustomer();
      await withdraw(userId);

      const res = await withdraw(userId);

      expect(res.status).toBe(200);
      expect(res.data).toEqual({ customer: 'not_found', auth_identities_deleted: 0 });
    });

    it('한 번도 로그인 안 한 회원(고객 없음)은 not_found / 0 으로 200 — 실패가 아니다', async () => {
      const res = await withdraw('00000000-0000-4000-8000-ffffffffffff');
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ customer: 'not_found', auth_identities_deleted: 0 });
    });

    it('고객은 없지만 sso identity 만 남은 상태(부분 실패 뒤 재시도)도 identity 를 지운다', async () => {
      const container = getContainer();
      const authModule = container.resolve(Modules.AUTH);
      const userId = `00000000-0000-4000-8000-a${String(seq).padStart(11, '0')}`;
      await authModule.createAuthIdentities([
        { provider_identities: [{ provider: 'user-service-sso', entity_id: userId, user_metadata: { email: 'x@y.z' } }] },
      ]);

      const res = await withdraw(userId);

      expect(res.data).toEqual({ customer: 'not_found', auth_identities_deleted: 1 });
      expect(await authModule.listProviderIdentities({ entity_id: userId, provider: 'user-service-sso' })).toHaveLength(0);
    });

    it('익명화 뒤 같은 이메일로 새 has_account 고객을 만들 수 있다 (유일 제약이 풀린다)', async () => {
      const { userId, email } = await seedWithdrawableCustomer();
      await withdraw(userId);
      const customerModule = getContainer().resolve(Modules.CUSTOMER);

      const [again] = await customerModule.createCustomers([{ email, has_account: true }]);

      expect(again.email).toBe(email);
    });

    it('almondUserId 가 UUID 꼴이 아니면 400', async () => {
      const res = await withdraw('not-a-uuid').catch((e) => e.response);
      expect(res.status).toBe(400);
    });
  },
});
