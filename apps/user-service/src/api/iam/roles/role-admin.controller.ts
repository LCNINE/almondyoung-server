import { RequirePermission } from '@app/authorization';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentIamActor, type IamActor } from '../iam-actor';
import {
  CreateRoleDto,
  DeleteRoleQueryDto,
  ReplaceRolePermissionsDto,
  RoleDetailDto,
  RoleSummaryDto,
  UpdateRoleDto,
} from './dto/role-admin.dto';
import { RoleAdminService } from './role-admin.service';

@ApiTags('Admin/Roles')
@ApiBearerAuth('access-token')
@Controller('admin/roles')
export class RoleAdminController {
  constructor(private readonly service: RoleAdminService) {}

  @ApiOperation({ summary: '역할 목록(고객 역할 포함 — audience 로 구분)' })
  @RequirePermission('iam.role.read')
  @Get()
  list(): Promise<RoleSummaryDto[]> {
    return this.service.list();
  }

  @ApiOperation({ summary: '역할 상세(권한 포함)' })
  @RequirePermission('iam.role.read')
  @Get(':roleId')
  detail(@Param('roleId', ParseUUIDPipe) roleId: string): Promise<RoleDetailDto> {
    return this.service.detail(roleId);
  }

  @ApiOperation({ summary: '역할 만들기(복제 포함)' })
  @RequirePermission('iam.role.write')
  @Post()
  create(@CurrentIamActor() actor: IamActor, @Body() dto: CreateRoleDto): Promise<RoleDetailDto> {
    return this.service.create(actor, dto);
  }

  @ApiOperation({ summary: '역할 표시 이름·설명·첫 화면 수정' })
  @RequirePermission('iam.role.write')
  @Patch(':roleId')
  update(
    @CurrentIamActor() actor: IamActor,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<RoleDetailDto> {
    return this.service.update(actor, roleId, dto);
  }

  @ApiOperation({ summary: '역할 권한 전체 교체(버전이 다르면 409)' })
  @RequirePermission('iam.role.write')
  @Put(':roleId/permissions')
  replacePermissions(
    @CurrentIamActor() actor: IamActor,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: ReplaceRolePermissionsDto,
  ): Promise<RoleDetailDto> {
    return this.service.replacePermissions(actor, roleId, dto);
  }

  @ApiOperation({ summary: '역할 삭제(부여 기록이 있으면 409)' })
  @RequirePermission('iam.role.write')
  @Delete(':roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @CurrentIamActor() actor: IamActor,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Query() query: DeleteRoleQueryDto,
  ): Promise<void> {
    return this.service.delete(actor, roleId, query.version);
  }
}
