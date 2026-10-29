import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import jwt from 'jsonwebtoken';

jest.setTimeout(120_000);

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    it('removes a revoked 3D model from the product HTTP response', async () => {
      const container = getContainer();
      const [user] = await container.resolve(Modules.USER).createUsers([{ email: 'model3d-admin@test.local' }]);
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE);
      const token = jwt.sign(
        {
          actor_id: user.id,
          actor_type: 'user',
          auth_identity_id: 'model3d-test',
          app_metadata: { user_id: user.id },
        },
        config.projectConfig.http.jwtSecret,
      );
      const headers = { headers: { authorization: `Bearer ${token}` } };
      const created = await api.post(
        '/admin/products',
        {
          title: '3D metadata test',
          status: 'draft',
          options: [{ title: 'Default', values: ['Default'] }],
          variants: [
            { title: 'Default', options: { Default: 'Default' }, prices: [{ amount: 1000, currency_code: 'krw' }] },
          ],
        },
        headers,
      );
      const productId = created.data.product.id;
      const fileId = '019a2ca4-9d00-7000-8000-000000000001';

      await api.post(`/admin/products/${productId}`, { metadata: { model3dFileId: fileId } }, headers);
      const attached = await api.get(`/admin/products/${productId}`, headers);

      expect(attached.data.product.metadata.model3dFileId).toBe(fileId);

      await api.post(`/admin/products/${productId}`, { metadata: { model3dFileId: '' } }, headers);
      const removed = await api.get(`/admin/products/${productId}`, headers);

      expect(removed.data.product.metadata).not.toHaveProperty('model3dFileId');
    });
  },
});
