import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { MasterRoleGuard } from '../guards/master-role.guard';
import { ScopeReader } from './scope.reader';
import { RoleScopeService } from './role-scope.service';
import { UpdateRoleScopesDto } from './dto/update-role-scopes.dto';
import { ScopeListResponseDto, RoleScopesResponseDto } from './dto/scope-response.dto';

@ApiTags('Authorization')
@ApiBearerAuth()
@Controller('authorization')
@UseGuards(JwtAuthGuard, MasterRoleGuard)
export class RoleScopeController {
  constructor(
    private readonly roleScopeService: RoleScopeService,
    private readonly scopeReader: ScopeReader,
  ) {}

  @Get('scopes')
  @ApiOperation({ summary: '이 앱에 등록된 모든 scope 목록 조회' })
  async getAllScopes(): Promise<ScopeListResponseDto> {
    try {
      const scopeList = await this.scopeReader.getAllScopes();
      return { scopes: scopeList, total: scopeList.length };
    } catch (e: any) {
      throw new InternalServerErrorException(e.message);
    }
  }

  @Get('role-scopes/:roleName')
  @ApiOperation({ summary: '특정 role에 매핑된 scope 목록 조회' })
  async getScopesByRole(@Param('roleName') roleName: string): Promise<RoleScopesResponseDto> {
    try {
      const scopeKeys = await this.scopeReader.getScopesByRole(roleName);
      return { roleName, scopes: scopeKeys };
    } catch (e: any) {
      throw new InternalServerErrorException(e.message);
    }
  }

  @Patch('role-scopes/:roleName')
  @ApiOperation({ summary: 'role-scope 매핑 편집 (add/remove diff)' })
  async updateRoleScopeMappings(
    @Param('roleName') roleName: string,
    @Body() dto: UpdateRoleScopesDto,
  ): Promise<RoleScopesResponseDto> {
    try {
      const updatedScopes = await this.roleScopeService.updateMappings(roleName, dto.add ?? [], dto.remove ?? []);
      return { roleName, scopes: updatedScopes };
    } catch (e: any) {
      const msg = (e?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException(e.message);
      if (msg.match(/already|invalid|failed|required|exceed/)) throw new BadRequestException(e.message);
      throw new InternalServerErrorException(e.message);
    }
  }
}
