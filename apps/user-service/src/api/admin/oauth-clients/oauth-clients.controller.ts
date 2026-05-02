import { RequireScopes } from '@app/authorization';
import { ApplicationException } from '@app/shared/filters/application.exception';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  InternalServerErrorException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  CreateOAuthClientDto,
  OAuthClientResponseDto,
  OAuthClientWithSecretResponseDto,
  UpdateOAuthClientDto,
} from './dto/oauth-clients.dto';
import { OAuthClientsService } from './oauth-clients.service';

function rethrow(e: unknown): never {
  if (e instanceof ApplicationException) {
    throw new HttpException(e.message, e.getHttpStatus());
  }
  if (e instanceof Error) {
    throw new InternalServerErrorException(e.message);
  }
  throw new InternalServerErrorException(String(e));
}

@ApiTags('Admin/OAuth Clients')
@ApiBearerAuth('access-token')
@Controller('/admin/oauth-clients')
export class OAuthClientsController {
  constructor(private readonly service: OAuthClientsService) {}

  @ApiOperation({ summary: 'OAuth client 목록' })
  @ApiResponse({ status: 200, type: [OAuthClientResponseDto] })
  @Get()
  @RequireScopes('master')
  async list(): Promise<OAuthClientResponseDto[]> {
    try {
      return await this.service.listClients();
    } catch (e) {
      rethrow(e);
    }
  }

  @ApiOperation({ summary: 'OAuth client 단건 조회' })
  @ApiResponse({ status: 200, type: OAuthClientResponseDto })
  @Get(':clientId')
  @RequireScopes('master')
  async get(@Param('clientId') clientId: string): Promise<OAuthClientResponseDto> {
    try {
      return await this.service.getClient(clientId);
    } catch (e) {
      rethrow(e);
    }
  }

  @ApiOperation({ summary: 'OAuth client 생성 (clientSecret 1회 노출)' })
  @ApiResponse({ status: 201, type: OAuthClientWithSecretResponseDto })
  @Post()
  @RequireScopes('master')
  async create(@Body() dto: CreateOAuthClientDto): Promise<OAuthClientWithSecretResponseDto> {
    try {
      return await this.service.createClient(dto);
    } catch (e) {
      rethrow(e);
    }
  }

  @ApiOperation({ summary: 'OAuth client 수정 (redirectUris/allowedScopes/isActive)' })
  @ApiResponse({ status: 200, type: OAuthClientResponseDto })
  @Patch(':clientId')
  @RequireScopes('master')
  async update(
    @Param('clientId') clientId: string,
    @Body() dto: UpdateOAuthClientDto,
  ): Promise<OAuthClientResponseDto> {
    try {
      return await this.service.updateClient(clientId, dto);
    } catch (e) {
      rethrow(e);
    }
  }

  @ApiOperation({ summary: 'client_secret 회전 (이전 secret 은 grace 동안 함께 유효)' })
  @ApiResponse({ status: 200, type: OAuthClientWithSecretResponseDto })
  @Post(':clientId/rotate-secret')
  @RequireScopes('master')
  async rotateSecret(@Param('clientId') clientId: string): Promise<OAuthClientWithSecretResponseDto> {
    try {
      return await this.service.rotateSecret(clientId);
    } catch (e) {
      rethrow(e);
    }
  }

  @ApiOperation({ summary: '회전 grace 종료 (previous_secret_hash 제거)' })
  @ApiResponse({ status: 200, type: OAuthClientResponseDto })
  @Post(':clientId/clear-previous-secret')
  @RequireScopes('master')
  async clearPreviousSecret(@Param('clientId') clientId: string): Promise<OAuthClientResponseDto> {
    try {
      return await this.service.clearPreviousSecret(clientId);
    } catch (e) {
      rethrow(e);
    }
  }

  @ApiOperation({ summary: 'OAuth client 비활성화 (soft)' })
  @ApiResponse({ status: 200, type: OAuthClientResponseDto })
  @Delete(':clientId')
  @RequireScopes('master')
  async deactivate(@Param('clientId') clientId: string): Promise<OAuthClientResponseDto> {
    try {
      return await this.service.deactivateClient(clientId);
    } catch (e) {
      rethrow(e);
    }
  }
}
