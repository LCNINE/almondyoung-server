import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptions } from 'passport-jwt';
import { AUTH_CONFIG } from '../constants';
import { AuthenticationService } from '../services/authentication.service';

interface AuthConfig {
  secret: string;
  issuer: string;
  audience: string;
}

/**
 * JWT Access Token Strategy
 * Validates JWT tokens using shared secret (HS256)
 * Supports both Authorization Bearer header and cookie-based authentication
 */
@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    private authService: AuthenticationService,
  ) {
    // config가 제대로 주입되었는지 확인
    if (!config?.secret) {
      throw new Error('AUTH_CONFIG.secret is not defined. Check AUTH_SECRET environment variable.');
    }

    const options: StrategyOptions = {
      jwtFromRequest: ExtractJwt.fromExtractors([
        // Authorization 헤더에서 Bearer 토큰 추출
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // 쿠키에서 토큰 추출 (fallback)
        (request: any) => {
          const token = request?.cookies?.accessToken;
          return token;
        },
      ]),
      secretOrKey: config.secret,
      ignoreExpiration: false,
    };

    super(options);
  }

  /**
   * Validate JWT payload
   * Delegates to AuthenticationService for validation logic
   */
  async validate(payload: any) {
    return this.authService.validatePayload(payload);
  }
}
