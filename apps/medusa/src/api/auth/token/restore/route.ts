import { IAuthModuleService } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from '@medusajs/framework/http';
import { generateJwtTokenForAuthIdentity } from '../../../../utils/generate-jwt-token';

// 새로 생성된 JWT 토큰을 가져옵니다. 기존 토큰이 유효한지에 대한 모든 검사는 이미 auth 미들웨어에서 처리됩니다.
// 생성된 토큰에는 actor ID가 포함됩니다. (기존 토큰에 actor ID가 없더라도 포함됨)
// 참고: 추후 비밀번호가 변경된 경우에는 토큰 재발급을 허용하지 않고, 재로그인을 요구하도록 처리하는 것이 좋습니다.
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const service: IAuthModuleService = req.scope.resolve(Modules.AUTH);

  const authIdentity = await service.retrieveAuthIdentity(
    req.auth_context.auth_identity_id,
  );

  const { http } = req.scope.resolve(
    ContainerRegistrationKeys.CONFIG_MODULE,
  ).projectConfig;

  const token = generateJwtTokenForAuthIdentity(
    { authIdentity, actorType: req.auth_context.actor_type },
    {
      secret: http.jwtSecret!,
      expiresIn: http.jwtExpiresIn,
      options: http.jwtOptions,
    },
  );

  return res.json({ token });
};
