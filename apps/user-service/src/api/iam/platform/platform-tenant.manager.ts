import { DbService, InjectDb } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { UserServiceSchema, UserServiceTx } from 'apps/user-service/database/drizzle/schema';
import { generateInitialPassword } from '../../admin/auth/lib/generate-initial-password';
import { PublicClientOriginsCache } from '../../oauth/cors/public-client-origins.cache';
import { redirectHost } from '../../oauth/redirect-uri';
import { IamAuditCreator } from '../audit/iam-audit.creator';
import type { IamActor } from '../iam-actor';
import {
  IamNotTenantMemberError,
  IamSelfChangeError,
  TenantDomainTakenError,
  TenantExistsError,
  TenantOwnSuspendError,
  TenantStatusConflictError,
} from '../iam.errors';
import { RoleRepository } from '../roles/role.repository';
import { ActorTenantReader } from '../tenancy/actor-tenant.reader';
import { PlatformOperatorManager } from '../tenancy/platform-operator.manager';
import { TenancyRepository } from '../tenancy/tenancy.repository';
import { PlatformRepository, type TenantRow, type TenantStatus } from './platform.repository';

/** 준비 → 활성 ↔ 정지. 준비로 되돌아가는 길은 없다(준비 중 실패는 삭제로 되돌린다). */
const NEXT_STATUS: Record<TenantStatus, readonly TenantStatus[]> = {
  preparing: ['active'],
  active: ['suspended'],
  suspended: ['active'],
};

export interface StaffClientUris {
  readonly redirectUris: readonly string[];
  readonly postLogoutRedirectUris: readonly string[];
}

const union = (current: readonly string[], more: readonly string[]) => [...new Set([...current, ...more])];

/** 로그아웃 주소가 비면 칸을 비운다(관리 API 와 같은 저장 꼴). */
const asStored = (redirectUris: string[], postLogoutRedirectUris: string[]) => ({
  redirectUris,
  postLogoutRedirectUris: postLogoutRedirectUris.length === 0 ? null : postLogoutRedirectUris,
});

export interface NewTenant {
  readonly id: string;
  readonly slug: string;
  readonly displayName: string;
  readonly logoUrl?: string | null;
  /** 테넌트 도메인(host, 포트 포함). 소문자로 맞춰 저장한다. */
  readonly domains: readonly string[];
}

/**
 * 플랫폼 운영자의 테넌트 관리 — 만들기 스크립트와 운영자가 부른다. 모든 쓰기는 운영자 성질을 먼저 보고(권한 키는 라우트 문일
 * 뿐이다), 변경 이력에 대상 테넌트를 남긴다.
 */
@Injectable()
export class PlatformTenantManager {
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    private readonly platform: PlatformRepository,
    private readonly tenancy: TenancyRepository,
    private readonly roles: RoleRepository,
    private readonly operators: PlatformOperatorManager,
    private readonly actorTenant: ActorTenantReader,
    private readonly audit: IamAuditCreator,
    private readonly publicClientOrigins: PublicClientOriginsCache,
  ) {}

  /** «준비» 상태로 만든다 — 준비가 끝날 때까지 이 테넌트로는 토큰이 나가지 않는다. */
  async createTenant(actor: IamActor, input: NewTenant): Promise<void> {
    const domains = [...new Set(input.domains.map((d) => d.toLowerCase()))];
    await this.dbService.run(async (tx) => {
      await this.operators.assertOperator(actor, tx);
      if (await this.platform.findTenant(input.id, tx))
        throw new TenantExistsError(`이미 있는 테넌트입니다: ${input.id}`);
      if (await this.platform.findTenantBySlug(input.slug, tx)) {
        throw new TenantExistsError(`이미 쓰는 slug 입니다: ${input.slug}`);
      }
      const taken = await this.platform.takenHosts(domains, tx);
      if (taken.length > 0) throw new TenantDomainTakenError(`다른 테넌트의 도메인입니다: ${taken.join(', ')}`);

      const row = await this.platform.insertTenant(
        { id: input.id, slug: input.slug, displayName: input.displayName, logoUrl: input.logoUrl ?? null },
        tx,
      );
      await this.platform.insertDomains(row.id, domains, tx);
      await this.audit.record(tx, actor, {
        tenantId: row.id,
        action: 'tenant.create',
        targetType: 'tenant',
        targetId: row.id,
        targetLabel: row.displayName,
        before: null,
        after: { slug: row.slug, status: row.status, displayName: row.displayName, logoUrl: row.logoUrl, domains },
      });
    });
  }

  /**
   * 상태를 바꾼다. 같은 상태면 아무것도 안 한다(스크립트를 다시 돌려도 되게). 정지는 그 테넌트 세션을 그 자리에서 끊는다 —
   * 남은 액세스 토큰은 core 가 상태를 보고 막는다(16).
   */
  async setStatus(actor: IamActor, tenantId: string, status: TenantStatus): Promise<void> {
    await this.dbService.run(async (tx) => {
      await this.operators.assertOperator(actor, tx);
      const row = await this.lockedTenant(tenantId, tx);
      if (row.status === status) return;
      if (!NEXT_STATUS[row.status].includes(status)) {
        throw new TenantStatusConflictError(`${row.status} 에서 ${status} 로 바꿀 수 없습니다.`);
      }
      if (status === 'suspended' && (await this.actorTenant.resolve(actor, tx)) === tenantId) {
        throw new TenantOwnSuspendError();
      }

      await this.platform.setStatus(tenantId, status, tx);
      const revokedSessions = status === 'suspended' ? await this.platform.revokeTenantSessions(tenantId, tx) : null;
      await this.audit.record(tx, actor, {
        tenantId,
        action: 'tenant.status.set',
        targetType: 'tenant',
        targetId: tenantId,
        targetLabel: row.displayName,
        before: { status: row.status },
        after: revokedSessions === null ? { status } : { status, revokedSessions },
      });
    });
  }

  /**
   * 테넌트를 지운다 — 만들기 스크립트가 목록에 넣기 전에 실패했을 때 되돌리는 길이라 «준비»만 된다. 소속·부여·세션·도메인은
   * cascade 로 지워지고, 웹 직원 앱 클라이언트에서 이 테넌트 도메인의 주소를 걷어낸다. 계정은 남는다(계정은 전역이다).
   */
  async deleteTenant(actor: IamActor, tenantId: string): Promise<void> {
    await this.dbService.run(async (tx) => {
      await this.operators.assertOperator(actor, tx);
      const row = await this.lockedTenant(tenantId, tx);
      if (row.status !== 'preparing') {
        throw new TenantStatusConflictError('준비 중인 테넌트만 지울 수 있습니다. 운영 중이면 정지하세요.');
      }
      if ((await this.platform.countClientsFixedTo(tenantId, tx)) > 0) {
        throw new TenantStatusConflictError('이 테넌트에 묶인 OAuth 클라이언트가 있어 지울 수 없습니다.');
      }
      const domains = await this.platform.domainsOf(tenantId, tx);
      const stripped = await this.stripStaffClientUris(new Set(domains), tx);

      await this.platform.deleteTenant(tenantId, tx);
      await this.audit.record(tx, actor, {
        tenantId,
        action: 'tenant.delete',
        targetType: 'tenant',
        targetId: tenantId,
        targetLabel: row.displayName,
        before: { slug: row.slug, status: row.status, displayName: row.displayName, domains },
        after: { strippedFromClients: stripped },
      });
    });
    this.publicClientOrigins.invalidate();
  }

  /** 계정을 이 테넌트의 직원으로 들인다(역할은 따로 준다). 이미 소속이면 아무것도 안 한다. */
  async addMember(actor: IamActor, tenantId: string, userId: string): Promise<void> {
    await this.dbService.run(async (tx) => {
      await this.operators.assertOperator(actor, tx);
      await this.lockedTenant(tenantId, tx);
      const user = await this.roles.findUser(userId, tx);
      if (!user) throw new NotFoundError('사용자를 찾을 수 없습니다.');
      if (await this.tenancy.isMember(userId, tenantId, tx)) return;

      await this.tenancy.addMembership(userId, tenantId, tx);
      await this.audit.record(tx, actor, {
        tenantId,
        action: 'tenant.membership.add',
        targetType: 'user',
        targetId: userId,
        targetLabel: user.loginId,
        before: { member: false },
        after: { member: true },
      });
    });
  }

  /**
   * 웹 직원 앱 클라이언트(같은 `admin-web`)에 이 테넌트 도메인의 리디렉트·로그아웃 주소를 더한다. 주소의 host 는 이 테넌트의
   * 도메인이어야 한다 — 그 host 가 로그인한 토큰의 테넌트를 정하기 때문이다. 이미 있는 주소는 그대로 둔다.
   */
  async addStaffClientUris(actor: IamActor, tenantId: string, clientId: string, uris: StaffClientUris): Promise<void> {
    await this.dbService.run(async (tx) => {
      await this.operators.assertOperator(actor, tx);
      const row = await this.lockedTenant(tenantId, tx);
      const client = await this.platform.lockClient(clientId, tx);
      if (!client) throw new NotFoundError(`OAuth 클라이언트를 찾을 수 없습니다: ${clientId}`);
      if (client.tenantId !== null) {
        throw new BadRequestError('고정 테넌트가 있는 클라이언트에는 테넌트 도메인 주소를 더하지 않습니다.');
      }
      const domains = new Set(await this.platform.domainsOf(tenantId, tx));
      const outside = [...uris.redirectUris, ...uris.postLogoutRedirectUris].filter(
        (uri) => !domains.has(redirectHost(uri) ?? ''),
      );
      if (outside.length > 0) {
        throw new BadRequestError(`이 테넌트의 도메인이 아닌 주소입니다: ${outside.join(', ')}`);
      }

      const before = { redirectUris: client.redirectUris, postLogoutRedirectUris: client.postLogoutRedirectUris ?? [] };
      const after = {
        redirectUris: union(before.redirectUris, uris.redirectUris),
        postLogoutRedirectUris: union(before.postLogoutRedirectUris, uris.postLogoutRedirectUris),
      };
      if (
        after.redirectUris.length === before.redirectUris.length &&
        after.postLogoutRedirectUris.length === before.postLogoutRedirectUris.length
      ) {
        return;
      }
      await this.platform.setClientUris(clientId, asStored(after.redirectUris, after.postLogoutRedirectUris), tx);
      await this.audit.record(tx, actor, {
        tenantId,
        action: 'tenant.oauth_redirects.add',
        targetType: 'oauth_client',
        targetId: clientId,
        targetLabel: `${clientId} (${row.displayName})`,
        before,
        after,
      });
    });
    this.publicClientOrigins.invalidate();
  }

  /**
   * 테넌트 직원의 비밀번호를 새로 정해 한 번만 돌려준다(저장하지 않는다). 테넌트 도메인엔 찾기가 없어 이것이 유일한 복구다.
   * 기본은 첫 로그인 때 변경 강제 — 점검 계정만 `forcePasswordChange = false`. 그 계정의 세션은 모두 끊는다.
   */
  async reissuePassword(
    actor: IamActor,
    tenantId: string,
    userId: string,
    forcePasswordChange = true,
  ): Promise<{ initialPassword: string }> {
    const initialPassword = generateInitialPassword();
    const hash = await bcrypt.hash(initialPassword, 10);
    await this.dbService.run(async (tx) => {
      await this.operators.assertOperator(actor, tx);
      await this.lockedTenant(tenantId, tx);
      if (userId === actor.userId) throw new IamSelfChangeError();
      const user = await this.roles.findUser(userId, tx);
      if (!user) throw new NotFoundError('사용자를 찾을 수 없습니다.');
      if (!(await this.tenancy.isMember(userId, tenantId, tx))) throw new IamNotTenantMemberError();

      await this.platform.setPassword(userId, hash, forcePasswordChange, tx);
      await this.platform.revokeUserSessions(userId, tx);
      await this.audit.record(tx, actor, {
        tenantId,
        action: 'user.password.reissue',
        targetType: 'user',
        targetId: userId,
        targetLabel: user.loginId,
        before: null,
        after: { mustChangePassword: forcePasswordChange },
      });
    });
    return { initialPassword };
  }

  private async lockedTenant(tenantId: string, tx: UserServiceTx): Promise<TenantRow> {
    const row = await this.platform.lockTenant(tenantId, tx);
    if (!row) throw new NotFoundError(`테넌트를 찾을 수 없습니다: ${tenantId}`);
    return row;
  }

  /** 웹 직원 앱 클라이언트에서 host 가 `hosts` 인 주소를 걷어낸다. 바뀐 클라이언트 id 를 돌려준다. */
  private async stripStaffClientUris(hosts: ReadonlySet<string>, tx: UserServiceTx): Promise<string[]> {
    if (hosts.size === 0) return [];
    const keep = (uri: string) => !hosts.has(redirectHost(uri) ?? '');
    const changed: string[] = [];
    for (const client of await this.platform.lockStaffClients(tx)) {
      const redirectUris = client.redirectUris.filter(keep);
      const logout = (client.postLogoutRedirectUris ?? []).filter(keep);
      if (
        redirectUris.length === client.redirectUris.length &&
        logout.length === (client.postLogoutRedirectUris ?? []).length
      ) {
        continue;
      }
      await this.platform.setClientUris(client.clientId, asStored(redirectUris, logout), tx);
      changed.push(client.clientId);
    }
    return changed;
  }
}
