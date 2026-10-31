import { RequirePermission } from '@app/authorization';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentIamActor, type IamActor } from '../iam-actor';
import {
  AddStaffClientUrisDto,
  AddTenantMemberDto,
  CreateTenantDto,
  ReissuedPasswordDto,
  ReissuePasswordDto,
  SetPlatformOperatorDto,
  SetTenantStatusDto,
  TenantDto,
} from './dto/platform.dto';
import { PlatformService } from './platform.service';

/**
 * 플랫폼 운영자 API — 만들기 스크립트와 운영자가 부른다. 권한 키는 라우트 문일 뿐이고, 판정은 iam Manager 가 운영자 성질로
 * 한다(테넌트 안의 master 가 키를 가져도 운영자가 아니면 403).
 */
@ApiTags('Admin/Platform')
@ApiBearerAuth('access-token')
@Controller('admin/platform')
export class PlatformController {
  constructor(private readonly service: PlatformService) {}

  @ApiOperation({ summary: '테넌트 목록(도메인 포함)' })
  @RequirePermission('iam.tenant.read')
  @Get('tenants')
  list(@CurrentIamActor() actor: IamActor): Promise<TenantDto[]> {
    return this.service.list(actor);
  }

  @ApiOperation({ summary: '테넌트 상세' })
  @RequirePermission('iam.tenant.read')
  @Get('tenants/:tenantId')
  get(@CurrentIamActor() actor: IamActor, @Param('tenantId') tenantId: string): Promise<TenantDto> {
    return this.service.get(actor, tenantId);
  }

  @ApiOperation({ summary: '테넌트 만들기(«준비» 상태, 도메인 1개 이상)' })
  @RequirePermission('iam.tenant.write')
  @Post('tenants')
  create(@CurrentIamActor() actor: IamActor, @Body() dto: CreateTenantDto): Promise<TenantDto> {
    return this.service.create(actor, dto);
  }

  @ApiOperation({ summary: '테넌트 상태 전환(준비 → 활성 ↔ 정지). 정지는 그 테넌트 세션을 끊는다' })
  @RequirePermission('iam.tenant.write')
  @Put('tenants/:tenantId/status')
  setStatus(
    @CurrentIamActor() actor: IamActor,
    @Param('tenantId') tenantId: string,
    @Body() dto: SetTenantStatusDto,
  ): Promise<TenantDto> {
    return this.service.setStatus(actor, tenantId, dto);
  }

  @ApiOperation({ summary: '준비 중인 테넌트 삭제(만들기 스크립트 되돌리기)' })
  @RequirePermission('iam.tenant.write')
  @Delete('tenants/:tenantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@CurrentIamActor() actor: IamActor, @Param('tenantId') tenantId: string): Promise<void> {
    return this.service.delete(actor, tenantId);
  }

  @ApiOperation({ summary: '계정을 테넌트 소속으로(역할은 따로 준다)' })
  @RequirePermission('iam.tenant.write')
  @Post('tenants/:tenantId/members')
  @HttpCode(HttpStatus.NO_CONTENT)
  addMember(
    @CurrentIamActor() actor: IamActor,
    @Param('tenantId') tenantId: string,
    @Body() dto: AddTenantMemberDto,
  ): Promise<void> {
    return this.service.addMember(actor, tenantId, dto.userId);
  }

  @ApiOperation({ summary: '웹 직원 앱 OAuth 클라이언트에 이 테넌트 도메인의 리디렉트·로그아웃 주소 더하기' })
  @RequirePermission('iam.tenant.write')
  @Post('tenants/:tenantId/oauth-clients/:clientId/uris')
  @HttpCode(HttpStatus.NO_CONTENT)
  addStaffClientUris(
    @CurrentIamActor() actor: IamActor,
    @Param('tenantId') tenantId: string,
    @Param('clientId') clientId: string,
    @Body() dto: AddStaffClientUrisDto,
  ): Promise<void> {
    return this.service.addStaffClientUris(actor, tenantId, clientId, dto);
  }

  @ApiOperation({ summary: '테넌트 직원 비밀번호 재발급(한 번만 돌려준다, 세션을 끊는다)' })
  @RequirePermission('iam.tenant.write')
  @Post('tenants/:tenantId/users/:userId/password')
  reissuePassword(
    @CurrentIamActor() actor: IamActor,
    @Param('tenantId') tenantId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ReissuePasswordDto,
  ): Promise<ReissuedPasswordDto> {
    return this.service.reissuePassword(actor, tenantId, userId, dto);
  }

  @ApiOperation({ summary: '플랫폼 운영자 성질 주기·거두기(마지막 운영자는 거둘 수 없다)' })
  @RequirePermission('iam.tenant.write')
  @Put('operators/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  setOperator(
    @CurrentIamActor() actor: IamActor,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetPlatformOperatorDto,
  ): Promise<void> {
    return this.service.setOperator(actor, userId, dto.isOperator);
  }
}
