import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../permissions/permission-catalog';

export const REQUIRED_PERMISSIONS_KEY = 'required_permissions';

/** 이 라우트를 부르려면 이 권한이 있어야 한다. */
export const RequirePermission = (permission: Permission) => SetMetadata(REQUIRED_PERMISSIONS_KEY, [permission]);

/** 나열한 권한 중 «하나라도» 있으면 된다. 하나뿐이면 `RequirePermission` 을 쓴다. */
export const RequireAnyPermission = (first: Permission, second: Permission, ...rest: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, [first, second, ...rest]);
