import { RequirePermission, RequireScopes } from '@app/authorization';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentIamActor, type IamActor } from '../iam-actor';
import {
  AddRoleMembersDto,
  ReplaceStaffRolesDto,
  ReplaceUserRolesDto,
  RoleMemberDto,
  UserRolesResponseDto,
} from './dto/role-assignment.dto';
import { RoleAssignmentService } from './role-assignment.service';

// 판정 주체가 바뀌기 전까지는 옛 표식(@RequireScopes)이 결과를 정한다 — 지금처럼 시스템 역할만.
@ApiTags('Admin/Role assignments')
@ApiBearerAuth('access-token')
@Controller()
export class RoleAssignmentController {
  constructor(private readonly service: RoleAssignmentService) {}

  @ApiOperation({ summary: '사람의 역할(기간 포함, 고객 역할 포함)' })
  @RequirePermission('iam.role.read')
  @Get('admin/users/:userId/roles')
  @RequireScopes('master')
  rolesOf(@Param('userId', ParseUUIDPipe) userId: string): Promise<UserRolesResponseDto> {
    return this.service.rolesOf(userId);
  }

  @ApiOperation({ summary: '사람의 역할 전체 교체(고객 역할 포함 — 남는 역할의 종료일 유지)' })
  @RequirePermission('iam.role.assign')
  @Put('admin/users/:userId/roles')
  @RequireScopes('master')
  replaceAll(
    @CurrentIamActor() actor: IamActor,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ReplaceUserRolesDto,
  ): Promise<void> {
    return this.service.replaceAll(actor, userId, dto);
  }

  @ApiOperation({ summary: '사람의 직원 역할만 교체(종료일 포함)' })
  @RequirePermission('iam.role.assign')
  @Put('admin/users/:userId/staff-roles')
  @RequireScopes('master')
  replaceStaff(
    @CurrentIamActor() actor: IamActor,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ReplaceStaffRolesDto,
  ): Promise<void> {
    return this.service.replaceStaff(actor, userId, dto);
  }

  @ApiOperation({ summary: '역할을 가진 사람(기간 지난 부여 포함)' })
  @RequirePermission('iam.role.read')
  @Get('admin/roles/:roleId/members')
  @RequireScopes('master')
  members(@Param('roleId', ParseUUIDPipe) roleId: string): Promise<RoleMemberDto[]> {
    return this.service.members(roleId);
  }

  @ApiOperation({ summary: '여러 사람에게 역할 추가(이미 있으면 종료일만 바꾼다)' })
  @RequirePermission('iam.role.assign')
  @Post('admin/roles/:roleId/members')
  @RequireScopes('master')
  addMembers(
    @CurrentIamActor() actor: IamActor,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: AddRoleMembersDto,
  ): Promise<void> {
    return this.service.addMembers(actor, roleId, dto);
  }

  @ApiOperation({ summary: '한 사람에게서 역할 회수' })
  @RequirePermission('iam.role.assign')
  @Delete('admin/roles/:roleId/members/:userId')
  @RequireScopes('master')
  removeMember(
    @CurrentIamActor() actor: IamActor,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.service.removeMember(actor, roleId, userId);
  }
}
