import { REQUIRED_PERMISSIONS_KEY, REQUIRED_SCOPES_KEY } from '@app/authorization';
import { RoleAssignmentController } from './role-assignment.controller';

const handlers = ['rolesOf', 'replaceAll', 'replaceStaff', 'members', 'addMembers', 'removeMember'] as const;

describe('RoleAssignmentController', () => {
  it.each(handlers)('%s keeps the legacy system-role marker until the decision switch', (name) => {
    const fn = RoleAssignmentController.prototype[name];
    expect(Reflect.getMetadata(REQUIRED_SCOPES_KEY, fn)).toEqual(['master']);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, fn)).toHaveLength(1);
  });
});
