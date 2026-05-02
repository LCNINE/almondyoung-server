import { Injectable } from '@nestjs/common';
import {
  CreateOAuthClientDto,
  OAuthClientResponseDto,
  OAuthClientWithSecretResponseDto,
  UpdateOAuthClientDto,
} from './dto/oauth-clients.dto';
import { OAuthClientsManager } from './oauth-clients.manager';
import { OAuthClientsReader } from './oauth-clients.reader';

@Injectable()
export class OAuthClientsService {
  constructor(
    private readonly reader: OAuthClientsReader,
    private readonly manager: OAuthClientsManager,
  ) {}

  listClients(): Promise<OAuthClientResponseDto[]> {
    return this.reader.listClients();
  }

  getClient(clientId: string): Promise<OAuthClientResponseDto> {
    return this.reader.getClient(clientId);
  }

  createClient(dto: CreateOAuthClientDto): Promise<OAuthClientWithSecretResponseDto> {
    return this.manager.createClient(dto);
  }

  updateClient(clientId: string, dto: UpdateOAuthClientDto): Promise<OAuthClientResponseDto> {
    return this.manager.updateClient(clientId, dto);
  }

  rotateSecret(clientId: string): Promise<OAuthClientWithSecretResponseDto> {
    return this.manager.rotateSecret(clientId);
  }

  clearPreviousSecret(clientId: string): Promise<OAuthClientResponseDto> {
    return this.manager.clearPreviousSecret(clientId);
  }

  deactivateClient(clientId: string): Promise<OAuthClientResponseDto> {
    return this.manager.deactivateClient(clientId);
  }
}
