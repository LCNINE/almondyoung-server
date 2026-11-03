import { RequirePermission } from '@app/authorization';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentIamActor, type IamActor } from '../iam-actor';
import {
  AddStaffClientUrisDto,
  AddTenantDomainDto,
  CreateFirstMasterDto,
  CreateTenantDto,
  FirstMasterDto,
  ReissuedPasswordDto,
  ReissuePasswordDto,
  SetPlatformOperatorDto,
  SetTenantStatusDto,
  TenantDto,
  TenantMasterDto,
} from './dto/platform.dto';
import { PlatformService } from './platform.service';

/**
 * 플랫폼 운영자 API — 만들기 스크립트와 운영자가 부른다. 권한 키는 라우트 문일 뿐이고, 판정은 iam Manager 가 운영자 성질로
 * 한다(테넌트 안의 master 가 키를 가져도 운영자가 아니면 403).
 *
 * 다른 테넌트의 계정에 닿는 라우트는 둘뿐이다(ADR-0056): 첫 master 만들기, master 비밀번호 비상 초기화(+ 그 둘이 다시 돌 때 보는
 * master 목록). 그 테넌트의 직원·부여는 그 테넌트의 master 가 관리한다. 늘리면 `operator-cross-tenant-routes.spec.ts` 가 빨갛다.
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

  @ApiOperation({ summary: '이미 있는 테넌트에 도메인 더하기(auth-web 주소 등). 이미 있으면 그대로' })
  @RequirePermission('iam.tenant.write')
  @Post('tenants/:tenantId/domains')
  addDomain(
    @CurrentIamActor() actor: IamActor,
    @Param('tenantId') tenantId: string,
    @Body() dto: AddTenantDomainDto,
  ): Promise<TenantDto> {
    return this.service.addDomain(actor, tenantId, dto);
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

  @ApiOperation({ summary: '그 테넌트에서 지금 master 인 계정(아이디만) — 만들기 스크립트의 재실행 판정' })
  @RequirePermission('iam.tenant.read')
  @Get('tenants/:tenantId/masters')
  masters(@CurrentIamActor() actor: IamActor, @Param('tenantId') tenantId: string): Promise<TenantMasterDto[]> {
    return this.service.masters(actor, tenantId);
  }

  @ApiOperation({
    summary: '그 테넌트의 첫 master 만들기(master 가 없을 때만, 비밀번호는 한 번만 돌려준다) — 교차 테넌트 일 ①',
  })
  @RequirePermission('iam.tenant.write')
  @Post('tenants/:tenantId/first-master')
  createFirstMaster(
    @CurrentIamActor() actor: IamActor,
    @Param('tenantId') tenantId: string,
    @Body() dto: CreateFirstMasterDto,
  ): Promise<FirstMasterDto> {
    return this.service.createFirstMaster(actor, tenantId, dto);
  }

  @ApiOperation({
    summary: '그 테넌트 master 의 비밀번호 비상 초기화(한 번만 돌려준다, 세션을 끊는다) — 교차 테넌트 일 ②',
  })
  @RequirePermission('iam.tenant.write')
  @Post('tenants/:tenantId/masters/:userId/password')
  resetMasterPassword(
    @CurrentIamActor() actor: IamActor,
    @Param('tenantId') tenantId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ReissuePasswordDto,
  ): Promise<ReissuedPasswordDto> {
    return this.service.resetMasterPassword(actor, tenantId, userId, dto);
  }

  @ApiOperation({ summary: '플랫폼 운영자 성질 주기·거두기(운영자 테넌트의 계정만, 마지막 운영자는 거둘 수 없다)' })
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
