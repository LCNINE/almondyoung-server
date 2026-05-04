import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { decode } from 'jsonwebtoken';
import { ExtractJwt, Strategy, StrategyOptions } from 'passport-jwt';
import { AUTH_CONFIG } from '../constants';
import { AuthenticationService } from '../services/authentication.service';

// jwks-rsa 는 `export = JwksRsa` (CommonJS) 형태라 default import 시 webpack 번들에서
// `(0, jwks_rsa_1.default) is not a function` 으로 깨진다. TS 의 `import = require` 로 강제.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import jwksClient = require('jwks-rsa');
type JwksClient = ReturnType<typeof jwksClient>;

/**
 * 공용 인증 strategy 가 받는 설정. dual-mode (RS256 OIDC + HS256 legacy) 를 지원하기 위해
 * `secret` 과 `jwksUri` 둘 다 optional. 최소 하나는 채워야 한다.
 *
 * - RS256 OIDC: `jwksUri`(필수) + `oidcIssuer`(권장, iss 검증) + `allowedAudiences`(선택, aud 화이트리스트)
 * - HS256 legacy: `secret`(필수) — Medusa my-auth 같은 기존 발급 토큰용 폴백
 */
export interface AuthConfig {
  secret?: string;
  issuer?: string;
  audience?: string;
  jwksUri?: string;
  oidcIssuer?: string;
  allowedAudiences?: string[];
}

/**
 * JWT Access Token Strategy (dual-mode)
 *
 * 토큰 헤더의 `kid` + `alg` 로 분기한다:
 *   - `kid` + `alg=RS256` → JWKS 에서 public key fetch (jwks-rsa, 캐시)
 *   - `alg=HS256`         → 대칭 secret (legacy)
 *
 * issuer/audience 검증은 strategy 옵션이 아닌 `validate()` 에서 수행한다.
 * legacy HS256 토큰은 iss/aud claim 자체가 없으므로 RS256 토큰일 때만 적용.
 */
@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly jwks: JwksClient | null;

  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    private authService: AuthenticationService,
  ) {
    if (!config?.secret && !config?.jwksUri) {
      throw new Error(
        'AUTH_CONFIG: either `secret` (HS256) or `jwksUri` (RS256/OIDC) must be defined.',
      );
    }

    const jwks = config.jwksUri
      ? jwksClient({
          jwksUri: config.jwksUri,
          cache: true,
          cacheMaxAge: 10 * 60 * 1000, // 10분 — 키 회전 주기 짧지 않으므로 충분
          rateLimit: true,
          jwksRequestsPerMinute: 30,
          timeout: 5_000,
        })
      : null;

    const options: StrategyOptions = {
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: any) => req?.cookies?.accessToken,
      ]),
      algorithms: ['RS256', 'HS256'],
      ignoreExpiration: false,
      // issuer/audience 는 일부러 비워둔다 — validate() 에서 알고리즘별로 분기 검증.
      secretOrKeyProvider: (_req, rawJwtToken, done) => {
        try {
          const decoded: any = decode(rawJwtToken, { complete: true });
          const kid = decoded?.header?.kid;
          const alg = decoded?.header?.alg;

          if (kid && alg === 'RS256') {
            if (!jwks) {
              return done(new Error('RS256 token but jwksUri not configured'));
            }
            jwks.getSigningKey(kid, (err, key) => {
              if (err || !key) return done(err ?? new Error('signing key not found'));
              done(null, key.getPublicKey());
            });
            return;
          }

          if (alg === 'HS256') {
            if (!config.secret) {
              return done(new Error('HS256 token but AUTH_SECRET not configured'));
            }
            return done(null, config.secret);
          }

          done(new Error(`unsupported alg: ${alg}`));
        } catch (e) {
          done(e as Error);
        }
      },
    };

    super(options);
    this.jwks = jwks;
  }

  async validate(payload: any) {
    // RS256 OIDC 토큰만 issuer/audience 검증. HS256 legacy 토큰은 claim 자체가 없음.
    if (payload?.iss) {
      if (this.config.oidcIssuer && payload.iss !== this.config.oidcIssuer) {
        throw new UnauthorizedException('invalid token issuer');
      }
      if (this.config.allowedAudiences && this.config.allowedAudiences.length > 0) {
        const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
        if (!aud || !this.config.allowedAudiences.includes(aud)) {
          throw new UnauthorizedException('invalid token audience');
        }
      }
    }

    return this.authService.validatePayload(payload);
  }
}
