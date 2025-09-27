import { SetMetadata } from '@nestjs/common';
import { UserScope } from '../constants';

export const SCOPES_KEY = 'required_scopes';

export const RequireScopes = (scopes: UserScope[]) =>
  SetMetadata(SCOPES_KEY, scopes);
