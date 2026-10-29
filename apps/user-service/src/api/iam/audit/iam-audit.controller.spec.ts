import { REQUIRED_PERMISSIONS_KEY } from '@app/authorization';
import { IamAuditController } from './iam-audit.controller';

describe('IamAuditController', () => {
  it('is decided by the history permission alone', () => {
    const fn = IamAuditController.prototype.page;
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, fn)).toEqual(['iam.audit_log.read']);
  });
});
