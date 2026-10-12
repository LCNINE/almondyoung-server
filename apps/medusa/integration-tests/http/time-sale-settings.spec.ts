import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import jwt from 'jsonwebtoken';
import { defaultTimeSaleSettings } from '../../../../packages/domain-types/time-sale';

jest.setTimeout(120 * 1000);

medusaIntegrationTestRunner({
  inApp: true,
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: { headers: Record<string, string> };
    let seq = 0;
    let originalMetadata: Record<string, unknown> | null = null;

    beforeEach(async () => {
      seq++;
      const container = getContainer();
      const [user] = await container.resolve(Modules.USER).createUsers([{ email: `admin${seq}@time-sale.test` }]);
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const token = jwt.sign(
        {
          actor_id: user.id,
          actor_type: 'user',
          auth_identity_id: 'test-admin-auth',
          app_metadata: { user_id: user.id },
        },
        config.projectConfig.http.jwtSecret,
      );
      adminHeaders = { headers: { authorization: `Bearer ${token}` } };

      const stores = container.resolve(Modules.STORE);
      const [store] = await stores.listStores();
      if (!store)
        await stores.createStores([
          { name: 'time-sale-spec', supported_currencies: [{ currency_code: 'krw', is_default: true }] },
        ]);

      const [current] = await stores.listStores();
      originalMetadata = current.metadata ?? {};
    });

    afterEach(async () => {
      const stores = getContainer().resolve(Modules.STORE);
      const [store] = await stores.listStores();
      const restored: Record<string, unknown> = { ...originalMetadata };

      for (const key of Object.keys(store.metadata ?? {})) {
        if (!(key in restored)) restored[key] = null;
      }

      await stores.updateStores(store.id, { metadata: restored });
    });

    const call = (fn: () => Promise<unknown>) =>
      fn().then(
        (res: any) => res,
        (err: any) => err.response,
      );

    describe('/admin/time-sale-settings', () => {
      it('토큰 없이 GET/POST 하면 401', async () => {
        const get = await call(() => api.get('/admin/time-sale-settings'));
        const post = await call(() =>
          api.post('/admin/time-sale-settings', { settings: defaultTimeSaleSettings(), revision: '' }),
        );

        expect(get.status).toBe(401);
        expect(post.status).toBe(401);
      });

      it('잘못된 revision 으로 POST 하면 409', async () => {
        const res = await call(() =>
          api.post(
            '/admin/time-sale-settings',
            { settings: defaultTimeSaleSettings(), revision: 'stale' },
            adminHeaders,
          ),
        );

        expect(res.status).toBe(409);
      });

      it.each([[undefined], [0], [null], [{}]])('문자열이 아닌 revision(%p)은 400', async (revision) => {
        const res = await call(() =>
          api.post('/admin/time-sale-settings', { settings: defaultTimeSaleSettings(), revision }, adminHeaders),
        );

        expect(res.status).toBe(400);
      });

      it('imageSize 0 이면 400 + 환경설정 메시지', async () => {
        const settings = defaultTimeSaleSettings();
        settings.environment.imageSize = 0;

        const res = await call(() => api.post('/admin/time-sale-settings', { settings, revision: '' }, adminHeaders));

        expect(res.status).toBe(400);
        expect(res.data.message).toBe(
          '환경설정 값이 올바르지 않습니다. 상품 이미지 크기는 1~1500 사이 정수여야 합니다.',
        );
      });

      it('settings 가 없으면 400', async () => {
        const res = await call(() => api.post('/admin/time-sale-settings', { revision: '' }, adminHeaders));

        expect(res.status).toBe(400);
      });

      it('저장 후 GET 이 같은 settings 와 새 revision 을 돌려준다', async () => {
        const settings = defaultTimeSaleSettings();
        settings.environment.imageSize = 321;

        const first = await api.get('/admin/time-sale-settings', adminHeaders);
        const saved = await api.post(
          '/admin/time-sale-settings',
          { settings, revision: first.data.revision },
          adminHeaders,
        );
        const loaded = await api.get('/admin/time-sale-settings', adminHeaders);

        expect(saved.status).toBe(200);
        expect(saved.data.revision).not.toBe(first.data.revision);
        expect(loaded.data.settings).toEqual(settings);
        expect(loaded.data.revision).toBe(saved.data.revision);

        const stale = await call(() =>
          api.post('/admin/time-sale-settings', { settings, revision: first.data.revision }, adminHeaders),
        );

        expect(stale.status).toBe(409);
      });
    });
  },
});
