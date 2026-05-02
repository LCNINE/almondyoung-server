import { Injectable } from '@nestjs/common';
import { OAuthClientResponseDto } from './dto/oauth-clients.dto';
import { OAuthClientNotFoundException } from './exceptions/oauth-clients.exceptions';
import { OAuthClientRow, OAuthClientsRepository } from './oauth-clients.repository';

export function toResponseDto(row: OAuthClientRow): OAuthClientResponseDto {
  return {
    clientId: row.clientId,
    clientType: row.clientType,
    redirectUris: row.redirectUris,
    allowedScopes: row.allowedScopes,
    isActive: row.isActive,
    hasPreviousSecret: row.previousSecretHash !== null,
    secretRotatedAt: row.secretRotatedAt,
    deactivatedAt: row.deactivatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class OAuthClientsReader {
  constructor(private readonly repo: OAuthClientsRepository) {}

  async listClients(): Promise<OAuthClientResponseDto[]> {
    const rows = await this.repo.findAll();
    return rows.map(toResponseDto);
  }

  async getClient(clientId: string): Promise<OAuthClientResponseDto> {
    return toResponseDto(await this.getRowOrThrow(clientId));
  }

  async getRowOrThrow(clientId: string): Promise<OAuthClientRow> {
    const row = await this.repo.findById(clientId);
    if (!row) throw new OAuthClientNotFoundException(`OAuth client 가 없습니다: ${clientId}`);
    return row;
  }
}
