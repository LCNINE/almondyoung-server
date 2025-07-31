import {
  AuthenticationInput,
  ConfigModule,
  IAuthModuleService,
} from '@medusajs/framework/types';
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from '@medusajs/framework/utils';
import {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from '@medusajs/framework/http';
import { generateJwtTokenForAuthIdentity } from '@utils/generate-jwt-token';
import { setAuthCookie } from '@utils/set-auth-cookie';

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  try {
    const { actor_type, auth_provider } = req.params;

    const config: ConfigModule = req.scope.resolve(
      ContainerRegistrationKeys.CONFIG_MODULE,
    );

    const service: IAuthModuleService = req.scope.resolve(Modules.AUTH);

    const authData = {
      url: req.url,
      headers: req.headers,
      query: req.query,
      body: req.body,
      protocol: req.protocol,
    } as AuthenticationInput;

    const { success, error, authIdentity, location } =
      await service.authenticate(auth_provider, authData);

    if (location) {
      return res.status(200).json({ location });
    }

    if (success && authIdentity) {
      const { http } = config.projectConfig;

      if (!http?.jwtSecret) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          'JWT secret is not configured',
        );
      }

      const token = generateJwtTokenForAuthIdentity(
        {
          authIdentity,
          actorType: actor_type,
        },
        {
          secret: http.jwtSecret,
          expiresIn: http.jwtExpiresIn,
          options: http.jwtOptions,
        },
      );

      // 쿠키 설정
      setAuthCookie(res, token);

      return res.status(200).json({
        token,
      });
    }

    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      error || 'Authentication failed',
    );
  } catch (error) {
    console.error('에러 발생', error);
    if (error instanceof MedusaError) {
      return res
        .status(error.type === MedusaError.Types.UNAUTHORIZED ? 401 : 500)
        .json({
          error: error.message,
          type: error.type,
        });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  await GET(req, res);
};
