import {
  AuthIdentityDTO,
  ProjectConfigOptions,
} from '@medusajs/framework/types';
import { generateJwtToken } from '@medusajs/framework/utils';
import { type Secret } from 'jsonwebtoken';

export function generateJwtTokenForAuthIdentity(
  {
    authIdentity,
    actorType,
  }: { authIdentity: AuthIdentityDTO; actorType: string },
  {
    secret,
    expiresIn,
    options,
  }: {
    secret: Secret;
    expiresIn: string | undefined;
    options?: ProjectConfigOptions['http']['jwtOptions'];
  },
) {
  const expiresIn_ = expiresIn ?? options?.expiresIn;
  const entityIdKey = `${actorType}_id`;
  const entityId = authIdentity?.app_metadata?.user_id as string | undefined;

  const token = generateJwtToken(
    {
      actor_id: entityId ?? '',
      actor_type: actorType,
      auth_identity_id: authIdentity?.id ?? '',
      app_metadata: {
        [entityIdKey]: entityId,
      },
    },
    {
      secret,
      expiresIn: expiresIn_,
      jwtOptions: options,
    },
  );

  return token;
}
