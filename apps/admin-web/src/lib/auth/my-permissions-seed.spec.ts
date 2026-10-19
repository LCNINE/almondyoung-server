import { QueryClient, hydrate } from '@tanstack/react-query';
import { authQueryKeys } from '@/lib/services/auth/query-keys';
import type { MyPermissions } from './my-permissions';
import { myPermissionsSeed } from './my-permissions-seed';

const value: MyPermissions = {
  roles: [{ name: 'admin', displayName: '관리자' }],
  permissions: new Set(['order.order.read', 'order.order.write']),
  version: 'v1',
  landingPath: null,
};

describe('myPermissionsSeed', () => {
  it('fills the browser cache with what the server already fetched, keeping when it was fetched', () => {
    const client = new QueryClient();
    hydrate(client, myPermissionsSeed(value, 1_000));
    expect(client.getQueryData<MyPermissions>(authQueryKeys.myPermissions())?.permissions.has('order.order.write')).toBe(true);
    expect(client.getQueryState(authQueryKeys.myPermissions())?.dataUpdatedAt).toBe(1_000);
  });

  it('never replaces a newer copy the browser already has', () => {
    const client = new QueryClient();
    const newer: MyPermissions = { ...value, permissions: new Set(['order.order.read']), version: 'v2' };
    client.setQueryData(authQueryKeys.myPermissions(), newer, { updatedAt: 5_000 });
    hydrate(client, myPermissionsSeed(value, 1_000));
    expect(client.getQueryData<MyPermissions>(authQueryKeys.myPermissions())?.version).toBe('v2');
  });
});
