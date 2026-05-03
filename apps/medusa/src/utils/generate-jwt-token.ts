import { AuthIdentityDTO, ProjectConfigOptions } from '@medusajs/framework/types';
import { generateJwtToken } from '@medusajs/framework/utils';
import { type Secret } from 'jsonwebtoken';

export function generateJwtTokenForAuthIdentity(
  {
    authIdentity,
    actorType,
    authProvider,
  }: { authIdentity: AuthIdentityDTO; actorType: string; authProvider?: string },
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
  const entityId = authIdentity?.app_metadata?.[entityIdKey] as string | undefined;

  // Medusa core 구현과 동치: provider_identities 에서 매칭되는 항목의 user_metadata 를 JWT 에 embed.
  // SSO provider (예: user-service-sso) 는 여기에 email/name/login_id 를 채워두므로,
  // 빠뜨리면 storefront 가 신규 customer 생성 시 email 을 못 찾아 400 ("Email is required") 으로 실패한다.
  const providerIdentity = authProvider
    ? authIdentity?.provider_identities?.find((pi) => pi.provider === authProvider)
    : authIdentity?.provider_identities?.[0];

  const token = generateJwtToken(
    {
      actor_id: entityId ?? '',
      actor_type: actorType,
      auth_identity_id: authIdentity?.id ?? '',
      app_metadata: {
        [entityIdKey]: entityId,
      },
      user_metadata: providerIdentity?.user_metadata ?? {},
    },
    {
      secret,
      expiresIn: expiresIn_,
      jwtOptions: options,
    },
  );

  return token;
}
