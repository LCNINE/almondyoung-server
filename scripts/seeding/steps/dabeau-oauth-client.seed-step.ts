/**
 * dabeau (clip 백엔드) OAuth client 시드.
 *
 * 두 그룹에 모두 포함되는 이유:
 *  - 'baseline': dabeau client가 등록되어 있어야 clip이 OAuth로 동작하므로 일반 시드에도 필요.
 *  - 'demo-salon': 시연 환경 from-scratch 구축 시 함께 시드.
 *
 * redirect URI는 환경에 따라 다르므로 env에서 받는다:
 *  - DABEAU_API_BASE_URL    (예: https://api.dev.dabeau.kr)
 *  - DABEAU_FRONTEND_BASE_URL (예: https://dev.dabeau.kr)
 *  - DABEAU_OIDC_CLIENT_SECRET (선택; 없으면 시더가 1회 생성·로그)
 *
 * env가 모두 비어있으면 dev 기본값을 사용한다. 운영 배포에는 반드시 env로 주입할 것.
 */
import { sql } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { SeedStep } from './base-seed-step';
import { SeedCheckResult, SeedApplyResult } from '../lib/types';

const CLIENT_ID = 'dabeau';
const DEFAULT_API_BASE = 'https://api.dev.dabeau.kr';
const DEFAULT_FRONTEND_BASE = 'https://dev.dabeau.kr';

interface DabeauClientResolved {
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  allowedScopes: string[];
  clientSecret?: string;
}

function resolveDabeauConfig(): DabeauClientResolved {
  const apiBase = (process.env.DABEAU_API_BASE_URL ?? DEFAULT_API_BASE).replace(
    /\/$/,
    '',
  );
  const frontendBase = (
    process.env.DABEAU_FRONTEND_BASE_URL ?? DEFAULT_FRONTEND_BASE
  ).replace(/\/$/, '');
  return {
    redirectUris: [`${apiBase}/auth/oauth/callback`],
    postLogoutRedirectUris: [`${frontendBase}/sign-in`],
    allowedScopes: ['openid', 'profile', 'email', 'offline_access'],
    clientSecret: process.env.DABEAU_OIDC_CLIENT_SECRET || undefined,
  };
}

export class DabeauOAuthClientSeedStep extends SeedStep {
  readonly groups = ['baseline', 'demo-salon'] as const;

  constructor(databaseUrl: string) {
    super('Dabeau OAuth Client', databaseUrl);
  }

  async check(): Promise<SeedCheckResult> {
    const config = resolveDabeauConfig();
    const rows = await this.client.unsafe<
      Array<{
        client_id: string;
        redirect_uris: string[];
        post_logout_redirect_uris: string[] | null;
      }>
    >(
      `SELECT client_id, redirect_uris, post_logout_redirect_uris
         FROM oauth_clients
        WHERE client_id = $1 AND is_active = true`,
      [CLIENT_ID],
    );

    if (rows.length === 0) {
      return {
        service: 'Dabeau OAuth Client',
        items: [
          {
            entity: 'oauth_clients (dabeau)',
            expected: 1,
            existing: 0,
            missing: 1,
            missingDetails: ['missing row'],
          },
        ],
        isFullySeeded: false,
        summary: 'dabeau client missing',
      };
    }

    const row = rows[0];
    const redirectsOk = config.redirectUris.every((u) =>
      (row.redirect_uris ?? []).includes(u),
    );
    const postLogoutOk = config.postLogoutRedirectUris.every((u) =>
      (row.post_logout_redirect_uris ?? []).includes(u),
    );
    const ok = redirectsOk && postLogoutOk;

    return {
      service: 'Dabeau OAuth Client',
      items: [
        {
          entity: 'oauth_clients (dabeau)',
          expected: 1,
          existing: ok ? 1 : 0,
          missing: ok ? 0 : 1,
          missingDetails: ok ? undefined : ['uri drift'],
        },
      ],
      isFullySeeded: ok,
      summary: ok ? 'dabeau client up to date' : 'dabeau client uri drift',
    };
  }

  async apply(): Promise<SeedApplyResult> {
    const start = Date.now();
    try {
      const config = resolveDabeauConfig();
      const plaintextSecret =
        config.clientSecret ?? crypto.randomBytes(32).toString('base64url');
      const secretHash = await bcrypt.hash(plaintextSecret, 10);

      this.logger.step(1, 1, 'Upserting dabeau OAuth client');
      await this.db.execute(sql`
        INSERT INTO oauth_clients (
          client_id, client_type, client_secret_hash,
          redirect_uris, post_logout_redirect_uris, allowed_scopes, is_active
        )
        VALUES (
          ${CLIENT_ID},
          ${'confidential'},
          ${secretHash},
          ${JSON.stringify(config.redirectUris)}::jsonb,
          ${JSON.stringify(config.postLogoutRedirectUris)}::jsonb,
          ${JSON.stringify(config.allowedScopes)}::jsonb,
          true
        )
        ON CONFLICT (client_id) DO UPDATE SET
          redirect_uris = EXCLUDED.redirect_uris,
          post_logout_redirect_uris = EXCLUDED.post_logout_redirect_uris,
          allowed_scopes = EXCLUDED.allowed_scopes,
          is_active = true,
          updated_at = now()
      `);

      if (!config.clientSecret) {
        // env 미주입으로 우리가 secret을 생성한 경우에만 1회 출력.
        // 이후 실행에서는 ON CONFLICT가 secret_hash를 안 건드림 (안정적).
        this.logger.warn(
          `Generated client_secret for "${CLIENT_ID}" — capture this value (will not be shown again):\n  ${plaintextSecret}`,
        );
      }

      this.logger.success('Dabeau OAuth client seeded');
      return {
        service: 'Dabeau OAuth Client',
        success: true,
        itemsApplied: 1,
        duration: Date.now() - start,
      };
    } catch (error: any) {
      this.logger.error('Dabeau OAuth client seeding failed', error);
      return {
        service: 'Dabeau OAuth Client',
        success: false,
        itemsApplied: 0,
        duration: Date.now() - start,
        error: error.message,
      };
    }
  }
}
