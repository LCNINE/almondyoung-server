import { SetMetadata } from '@nestjs/common';
import { UserScope } from '../constants/scopes.constant';

export const REQUIRED_SCOPES = 'required_scopes';

export const RequireScopes = (scopes: UserScope[]) =>
  SetMetadata(REQUIRED_SCOPES, scopes);
