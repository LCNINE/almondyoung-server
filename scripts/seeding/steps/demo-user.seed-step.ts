/**
 * Demo user 시드 — clip(다른 repo)의 시연용 데모 OAuth 계정.
 *
 * 이 user.id는 clip의 accounts.externalUserId와 일치하므로 OAuth 콜백에서
 * pre-seeded clip account가 자연스럽게 매칭된다.
 *
 * 비밀번호:
 *  - env DEMO_PASSWORD 우선
 *  - 없으면 기본값 'demo!1234' (clip/apps/backend/scripts/seeding/fixtures/demo.ts
 *    DEMO_PASSWORD_DEFAULT와 일치)
 */
import { sql } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { SeedStep } from './base-seed-step';
import { SeedCheckResult, SeedApplyResult } from '../lib/types';
import { FIXED_UUIDS } from '../constants/uuids';

const DEMO_USER = {
  id: FIXED_UUIDS.USER_DEMO,
  loginId: 'demo',
  username: 'Demo User',
  nickname: '데모',
  email: 'demo@dabeau.kr',
  isEmailVerified: true,
} as const;

export type DemoUserSeedConfig = {
  /** 평문 비밀번호 — bcrypt(10)으로 해시됨 */
  demoPassword: string;
};

export class DemoUserSeedStep extends SeedStep {
  readonly groups = ['demo-salon'] as const;

  private demoPassword: string;

  constructor(databaseUrl: string, config: DemoUserSeedConfig) {
    super('Demo User', databaseUrl);
    this.demoPassword = config.demoPassword;
  }

  async check(): Promise<SeedCheckResult> {
    // 행이 존재하더라도 필드가 기대값과 다르면 drift 로 간주해 재적용한다.
    const userRows = await this.client`
      SELECT login_id, username, nickname, email, is_email_verified
      FROM users WHERE id = ${DEMO_USER.id}
    `;
    let userMissing = 0;
    const driftedFields: string[] = [];
    if (userRows.length === 0) {
      userMissing = 1;
    } else {
      const row = userRows[0];
      if (row.login_id !== DEMO_USER.loginId) driftedFields.push('login_id');
      if (row.username !== DEMO_USER.username) driftedFields.push('username');
      if (row.nickname !== DEMO_USER.nickname) driftedFields.push('nickname');
      if (row.email !== DEMO_USER.email) driftedFields.push('email');
      if (row.is_email_verified !== DEMO_USER.isEmailVerified) driftedFields.push('is_email_verified');
      if (driftedFields.length > 0) userMissing = 1;
    }

    // role 매핑 확인 (USER_ROLE 부여 여부)
    const roleRows = await this.client`
      SELECT role_id::text FROM user_roles WHERE user_id = ${DEMO_USER.id}
    `;
    const expectedRoles = [FIXED_UUIDS.ROLE_USER];
    const existingRoles = new Set(roleRows.map((r) => r.role_id));
    const missingRoles = expectedRoles.filter((r) => !existingRoles.has(r));

    const driftDetail = driftedFields.length > 0 ? `${DEMO_USER.loginId} (drift: ${driftedFields.join(', ')})` : DEMO_USER.loginId;
    const items = [
      {
        entity: 'users (demo)',
        expected: 1,
        existing: 1 - userMissing,
        missing: userMissing,
        missingDetails: userMissing > 0 ? [driftDetail] : undefined,
      },
      {
        entity: 'user_roles (demo)',
        expected: expectedRoles.length,
        existing: expectedRoles.length - missingRoles.length,
        missing: missingRoles.length,
      },
    ];

    const isFullySeeded = items.every((i) => i.missing === 0);
    return {
      service: 'Demo User',
      items,
      isFullySeeded,
      summary: isFullySeeded
        ? 'Demo user present'
        : driftedFields.length > 0
          ? `demo user drift: ${driftedFields.join(', ')}`
          : `${userMissing} user(s), ${missingRoles.length} role(s) missing`,
    };
  }

  async apply(): Promise<SeedApplyResult> {
    const start = Date.now();
    let itemsApplied = 0;

    try {
      this.logger.step(1, 2, 'Upserting demo user');
      const hashed = await bcrypt.hash(this.demoPassword, 10);
      await this.db.execute(sql`
        INSERT INTO users (id, login_id, username, nickname, email, password, is_email_verified)
        VALUES (
          ${DEMO_USER.id}, ${DEMO_USER.loginId}, ${DEMO_USER.username},
          ${DEMO_USER.nickname}, ${DEMO_USER.email}, ${hashed},
          ${DEMO_USER.isEmailVerified}
        )
        ON CONFLICT (id) DO UPDATE SET
          login_id = EXCLUDED.login_id,
          username = EXCLUDED.username,
          nickname = EXCLUDED.nickname,
          email = EXCLUDED.email,
          password = EXCLUDED.password,
          is_email_verified = EXCLUDED.is_email_verified
      `);
      itemsApplied += 1;

      this.logger.step(2, 2, 'Assigning user role');
      await this.db.execute(sql`
        INSERT INTO user_roles (user_id, role_id)
        VALUES (${DEMO_USER.id}, ${FIXED_UUIDS.ROLE_USER})
        ON CONFLICT DO NOTHING
      `);
      itemsApplied += 1;

      this.logger.success('Demo user seeded');
      return {
        service: 'Demo User',
        success: true,
        itemsApplied,
        duration: Date.now() - start,
      };
    } catch (error: any) {
      this.logger.error('Demo user seeding failed', error);
      return {
        service: 'Demo User',
        success: false,
        itemsApplied,
        duration: Date.now() - start,
        error: error.message,
      };
    }
  }
}
