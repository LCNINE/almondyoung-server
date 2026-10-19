import { REQUIRED_PERMISSIONS_KEY, REQUIRED_SCOPES_KEY } from '@app/authorization';
import { IamAuditController } from './iam-audit.controller';

describe('IamAuditController', () => {
  it('lets the staff who read admin users through the legacy guard, and asks for the history permission', () => {
    const fn = IamAuditController.prototype.page;
    expect(Reflect.getMetadata(REQUIRED_SCOPES_KEY, fn)).toEqual(['master', 'admin:users:read']);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, fn)).toEqual(['iam.audit_log.read']);
  });
});
