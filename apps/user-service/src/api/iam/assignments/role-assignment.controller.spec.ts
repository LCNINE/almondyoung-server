import { REQUIRED_PERMISSIONS_KEY, REQUIRED_SCOPES_KEY } from '@app/authorization';
import { RoleAssignmentController } from './role-assignment.controller';

const handlers = ['rolesOf', 'replaceAll', 'replaceStaff', 'members', 'addMembers', 'removeMember'] as const;

describe('RoleAssignmentController', () => {
  it.each(handlers)('%s is decided by its permission key alone', (name) => {
    const fn = RoleAssignmentController.prototype[name];
    expect(Reflect.getMetadata(REQUIRED_SCOPES_KEY, fn)).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, fn)).toHaveLength(1);
  });
});
