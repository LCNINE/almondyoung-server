import { REQUIRED_PERMISSIONS_KEY, REQUIRED_SCOPES_KEY } from '@app/authorization';
import { RoleAdminController } from './role-admin.controller';

const handlers = ['list', 'detail', 'create', 'update', 'replacePermissions', 'delete'] as const;

describe('RoleAdminController', () => {
  it.each(handlers)('%s is decided by its permission key alone', (name) => {
    const fn = RoleAdminController.prototype[name];
    expect(Reflect.getMetadata(REQUIRED_SCOPES_KEY, fn)).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, fn)).toHaveLength(1);
  });
});
