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
 */
@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(AUTH_CONFIG) private config: AuthConfig,
    private authService: AuthenticationService,
  ) {
    const options: StrategyOptions = {
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: any) => {
          // User Service와 동일하게 쿠키만 사용
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
