import { BadRequestError } from '@app/shared';
import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import {
  CreateOAuthClientDto,
  OAuthClientResponseDto,
  OAuthClientWithSecretResponseDto,
  UpdateOAuthClientDto,
} from './dto/oauth-clients.dto';
import { PublicClientOriginsCache } from '../../oauth/cors/public-client-origins.cache';
import { redirectHost } from '../../oauth/redirect-uri';
import { OAuthClientAlreadyExistsException } from './exceptions/oauth-clients.exceptions';
import { OAuthClientsReader, toResponseDto } from './oauth-clients.reader';
import { OAuthClientsRepository } from './oauth-clients.repository';

const BCRYPT_COST = 10;
const SECRET_BYTES = 32;

function generateClientSecret(): string {
  return crypto.randomBytes(SECRET_BYTES).toString('base64url');
}

// public client는 secret을 사용하지 않지만 schema의 NOT NULL 제약을 만족시키기 위해
// 검증 불가능한 랜덤 hash를 저장한다(분기 누락 시에도 fail-safe).
async function unguessableHash(): Promise<string> {
  return bcrypt.hash(crypto.randomBytes(32).toString('hex'), BCRYPT_COST);
}

@Injectable()
export class OAuthClientsManager {
  constructor(
    private readonly repo: OAuthClientsRepository,
    private readonly reader: OAuthClientsReader,
    private readonly publicClientOrigins: PublicClientOriginsCache,
  ) {}

  async createClient(dto: CreateOAuthClientDto): Promise<OAuthClientWithSecretResponseDto> {
    const existing = await this.repo.findById(dto.clientId);
    if (existing) {
      throw new OAuthClientAlreadyExistsException(`이미 등록된 clientId 입니다: ${dto.clientId}`);
    }
    if (dto.tenantId && !(await this.repo.tenantExists(dto.tenantId))) {
      throw new BadRequestError(`없는 테넌트입니다: ${dto.tenantId}`);
    }
    await this.assertStaffRedirectsOnTenantDomains(dto.tenantId ?? null, dto.redirectUris);
    const clientType = dto.clientType ?? 'confidential';
    const isPublic = clientType === 'public';
    const clientSecret = isPublic ? null : generateClientSecret();
    const clientSecretHash = isPublic ? await unguessableHash() : await bcrypt.hash(clientSecret as string, BCRYPT_COST);

    const row = await this.repo.create({
      clientId: dto.clientId,
      clientType,
      clientSecretHash,
      redirectUris: dto.redirectUris,
      postLogoutRedirectUris: dto.postLogoutRedirectUris ?? null,
      allowedScopes: dto.allowedScopes ?? null,
      tenantId: dto.tenantId ?? null,
    });
    this.publicClientOrigins.invalidate();
    return { ...toResponseDto(row), clientSecret };
  }

  async updateClient(clientId: string, dto: UpdateOAuthClientDto): Promise<OAuthClientResponseDto> {
    const current = await this.reader.getRowOrThrow(clientId);
    const patch: Parameters<OAuthClientsRepository['update']>[1] = {};
    if (dto.redirectUris !== undefined) {
      await this.assertStaffRedirectsOnTenantDomains(current.tenantId, dto.redirectUris);
      patch.redirectUris = dto.redirectUris;
    }
    if (dto.postLogoutRedirectUris !== undefined) {
      patch.postLogoutRedirectUris = dto.postLogoutRedirectUris.length === 0 ? null : dto.postLogoutRedirectUris;
    }
    if (dto.allowedScopes !== undefined) {
      patch.allowedScopes = dto.allowedScopes.length === 0 ? null : dto.allowedScopes;
    }
    if (dto.isActive !== undefined) {
      patch.isActive = dto.isActive;
      patch.deactivatedAt = dto.isActive ? null : new Date();
    }
    const updated = await this.repo.update(clientId, patch);
    this.publicClientOrigins.invalidate();
    return toResponseDto(updated);
  }

  /**
   * 웹 직원 앱(고정 테넌트 없음)은 리디렉트 host 가 토큰 테넌트를 정한다. 테넌트 도메인이 아닌 주소는 등록해도 로그인이 거절되므로
   * 저장할 때 막는다. 새 테넌트 도메인은 테넌트 행에 먼저 더한다.
   */
  private async assertStaffRedirectsOnTenantDomains(tenantId: string | null, redirectUris: string[]): Promise<void> {
    if (tenantId) return;
    const hosts = redirectUris.map((uri) => redirectHost(uri) ?? uri);
    const unknown = await this.repo.hostsWithoutTenant([...new Set(hosts)]);
    if (unknown.length > 0) {
      throw new BadRequestError(
        `테넌트 도메인이 아닌 리디렉트 주소입니다(고정 테넌트 없는 클라이언트): ${unknown.join(', ')}`,
      );
    }
  }

  async rotateSecret(clientId: string): Promise<OAuthClientWithSecretResponseDto> {
    const current = await this.reader.getRowOrThrow(clientId);
    if (current.clientType === 'public') {
      throw new Error('public client는 client_secret을 사용하지 않아 회전할 수 없습니다.');
    }
    const newSecret = generateClientSecret();
    const newHash = await bcrypt.hash(newSecret, BCRYPT_COST);
    const updated = await this.repo.rotateSecret(clientId, current.clientSecretHash, newHash);
    return { ...toResponseDto(updated), clientSecret: newSecret };
  }

  async clearPreviousSecret(clientId: string): Promise<OAuthClientResponseDto> {
    await this.reader.getRowOrThrow(clientId);
    const updated = await this.repo.clearPreviousSecret(clientId);
    return toResponseDto(updated);
  }

  async deactivateClient(clientId: string): Promise<OAuthClientResponseDto> {
    await this.reader.getRowOrThrow(clientId);
    const updated = await this.repo.update(clientId, { isActive: false, deactivatedAt: new Date() });
    this.publicClientOrigins.invalidate();
    return toResponseDto(updated);
  }
}
