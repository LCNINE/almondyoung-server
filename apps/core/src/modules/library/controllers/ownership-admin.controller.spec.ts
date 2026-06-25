import { GUARDS_METADATA } from '@nestjs/common/constants';

import { OwnershipAdminController } from './ownership-admin.controller';

describe('OwnershipAdminController authorization', () => {
  function makeContext(roles?: string[]) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user: roles ? { roles } : undefined }),
      }),
    } as any;
  }

  it('is protected by an admin/master roles guard at controller level', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, OwnershipAdminController) as Array<
      new () => { canActivate: (ctx: any) => boolean }
    >;

    expect(guards).toHaveLength(1);
    const guard = new guards[0]();

    expect(guard.canActivate(makeContext(['admin']))).toBe(true);
    expect(guard.canActivate(makeContext(['master']))).toBe(true);
    expect(guard.canActivate(makeContext(['customer']))).toBe(false);
    expect(guard.canActivate(makeContext())).toBe(false);
  });
});
