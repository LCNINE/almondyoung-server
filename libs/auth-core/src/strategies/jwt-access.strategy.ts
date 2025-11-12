import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptions } from 'passport-jwt';
import { AUTH_CONFIG } from '../constants';

interface AuthConfig {
  secret: string;
  issuer: string;
  audience: string;
}

/**
 * JWT Access Token Strategy
 * Validates JWT tokens using shared secret (HS256)
 * Reads JWT_VERIFICATION_TOKEN_SECRET from root .env file via AUTH_CONFIG
 */
@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(@Inject(AUTH_CONFIG) private config: AuthConfig) {
    console.log('🔐 [JwtAccessStrategy] Initializing with config:', {
      hasSecret: !!config.secret,
      secretLength: config.secret?.length,
      issuer: config.issuer,
      audience: config.audience,
    });

    const options: StrategyOptions = {
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (request: any) => {
          const token = request?.cookies?.accessToken;
          console.log('🍪 [JwtAccessStrategy] Extracting token:', {
            hasCookie: !!token,
            hasAuthHeader: !!request?.headers?.authorization,
            tokenPreview: token ? token.substring(0, 20) + '...' : 'none',
          });
          return token;
        },
      ]),
      secretOrKey: config.secret,
      // issuer: config.issuer, // 임시로 비활성화
      // audience: config.audience, // 임시로 비활성화
      ignoreExpiration: false,
    };

    super(options);
  }

  /**
   * Validate JWT payload
   * Maps payload to req.user (Stateless - no DB query)
   */
  async validate(payload: any) {
    console.log('✅ [JwtAccessStrategy] Token validated, payload:', {
      sub: payload.sub,
      email: payload.email,
      roles: payload.roles,
      iss: payload.iss,
      aud: payload.aud,
    });

    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return {
      userId: payload.sub,
      roles: payload.roles || [],
      scopes: payload.scopes || [],
      email: payload.email,
      ...payload,
    };
  }
}
