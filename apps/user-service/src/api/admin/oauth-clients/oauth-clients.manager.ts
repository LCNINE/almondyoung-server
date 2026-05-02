import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import {
  CreateOAuthClientDto,
  OAuthClientResponseDto,
  OAuthClientWithSecretResponseDto,
  UpdateOAuthClientDto,
} from './dto/oauth-clients.dto';
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
  ) {}

  async createClient(dto: CreateOAuthClientDto): Promise<OAuthClientWithSecretResponseDto> {
    const existing = await this.repo.findById(dto.clientId);
    if (existing) {
      throw new OAuthClientAlreadyExistsException(`이미 등록된 clientId 입니다: ${dto.clientId}`);
    }
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
    });
    return { ...toResponseDto(row), clientSecret };
  }

  async updateClient(clientId: string, dto: UpdateOAuthClientDto): Promise<OAuthClientResponseDto> {
    await this.reader.getRowOrThrow(clientId);
    const patch: Parameters<OAuthClientsRepository['update']>[1] = {};
    if (dto.redirectUris !== undefined) patch.redirectUris = dto.redirectUris;
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
    return toResponseDto(updated);
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
    return toResponseDto(updated);
  }
}
