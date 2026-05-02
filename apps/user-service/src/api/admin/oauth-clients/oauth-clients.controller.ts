import { RequireScopes } from '@app/authorization';
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  CreateOAuthClientDto,
  OAuthClientResponseDto,
  OAuthClientWithSecretResponseDto,
  UpdateOAuthClientDto,
} from './dto/oauth-clients.dto';
import { OAuthClientsService } from './oauth-clients.service';

@ApiTags('Admin/OAuth Clients')
@ApiBearerAuth('access-token')
@Controller('/admin/oauth-clients')
export class OAuthClientsController {
  constructor(private readonly service: OAuthClientsService) {}

  @ApiOperation({ summary: 'OAuth client 목록' })
  @ApiResponse({ status: 200, type: [OAuthClientResponseDto] })
  @Get()
  @RequireScopes('master')
  list(): Promise<OAuthClientResponseDto[]> {
    return this.service.listClients();
  }

  @ApiOperation({ summary: 'OAuth client 단건 조회' })
  @ApiResponse({ status: 200, type: OAuthClientResponseDto })
  @Get(':clientId')
  @RequireScopes('master')
  get(@Param('clientId') clientId: string): Promise<OAuthClientResponseDto> {
    return this.service.getClient(clientId);
  }

  @ApiOperation({ summary: 'OAuth client 생성 (clientSecret 1회 노출)' })
  @ApiResponse({ status: 201, type: OAuthClientWithSecretResponseDto })
  @Post()
  @RequireScopes('master')
  create(@Body() dto: CreateOAuthClientDto): Promise<OAuthClientWithSecretResponseDto> {
    return this.service.createClient(dto);
  }

  @ApiOperation({ summary: 'OAuth client 수정 (redirectUris/allowedScopes/isActive)' })
  @ApiResponse({ status: 200, type: OAuthClientResponseDto })
  @Patch(':clientId')
  @RequireScopes('master')
  update(
    @Param('clientId') clientId: string,
    @Body() dto: UpdateOAuthClientDto,
  ): Promise<OAuthClientResponseDto> {
    return this.service.updateClient(clientId, dto);
  }

  @ApiOperation({ summary: 'client_secret 회전 (이전 secret 은 grace 동안 함께 유효)' })
  @ApiResponse({ status: 200, type: OAuthClientWithSecretResponseDto })
  @Post(':clientId/rotate-secret')
  @RequireScopes('master')
  rotateSecret(@Param('clientId') clientId: string): Promise<OAuthClientWithSecretResponseDto> {
    return this.service.rotateSecret(clientId);
  }

  @ApiOperation({ summary: '회전 grace 종료 (previous_secret_hash 제거)' })
  @ApiResponse({ status: 200, type: OAuthClientResponseDto })
  @Post(':clientId/clear-previous-secret')
  @RequireScopes('master')
  clearPreviousSecret(@Param('clientId') clientId: string): Promise<OAuthClientResponseDto> {
    return this.service.clearPreviousSecret(clientId);
  }

  @ApiOperation({ summary: 'OAuth client 비활성화 (soft)' })
  @ApiResponse({ status: 200, type: OAuthClientResponseDto })
  @Delete(':clientId')
  @RequireScopes('master')
  deactivate(@Param('clientId') clientId: string): Promise<OAuthClientResponseDto> {
    return this.service.deactivateClient(clientId);
  }
}
