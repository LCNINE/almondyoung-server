import { RequireScopes } from '@app/authorization';
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BusinessLicenseResponseDto } from '../../business-licenses/dto/business-license.response.dto';
import { BusinessLicensesService } from './business-licenses.service';
import { BusinessAdminUpdateDto } from './dto/business-updeta.dto';
import { BusinessAdminUpsertDto } from './dto/business-upsert.dto';
import { BusinessLicenseQueryDto } from './dto/pagination-query-dto';

@ApiTags('사업자 등록 관리')
@ApiBearerAuth('access-token')
@Controller('admin/business-licenses')
export class BusinessLicensesController {
  constructor(private readonly businessLicensesService: BusinessLicensesService) {}

  @Get('/user/:userId')
  @ApiOperation({
    summary: '관리자가 특정 사용자의 사업자 등록 정보 조회',
    description: '관리자가 특정 사용자의 사업자 등록 정보를 조회합니다.',
  })
  @ApiParam({ name: 'userId', description: '사용자 ID' })
  @ApiResponse({ status: 200, description: '사업자 등록 정보 조회 성공' })
  @ApiResponse({ status: 401, description: '인증되지 않은 사용자' })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @RequireScopes('user:read')
  async getBusinessLicensesByUserId(@Param('userId') userId: string): Promise<BusinessLicenseResponseDto | null> {
    return this.businessLicensesService.getBusinessLicensesByUserId(userId);
  }

  @Post('/user/:userId')
  @RequireScopes('master', 'admin:users:modify')
  @ApiOperation({
    summary: '관리자가 특정 사용자의 사업자 등록 정보 등록/수정',
    description:
      '관리자가 특정 사용자의 사업자 등록 정보를 등록하거나 수정합니다. ' +
      '사용자당 사업자 등록은 1개이므로 기존 정보가 있으면 수정, 없으면 새로 생성합니다.',
  })
  @ApiParam({ name: 'userId', description: '사용자 ID' })
  @ApiResponse({ status: 201, description: '사업자 등록 정보 등록/수정 성공' })
  @ApiResponse({ status: 404, description: '사용자를 찾을 수 없음' })
  async upsertBusinessLicenseByUserId(
    @Param('userId') userId: string,
    @Body() upsertBusinessLicenseDto: BusinessAdminUpsertDto,
  ): Promise<BusinessLicenseResponseDto> {
    return this.businessLicensesService.upsertBusinessLicenseByUserId(userId, upsertBusinessLicenseDto);
  }

  @Get()
  @RequireScopes('master', 'admin:users:read')
  @ApiOperation({
    summary: '사업자 등록 목록 조회',
    description: '사업자 등록 신청 목록을 페이지네이션하여 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '사업자 등록 목록 조회 성공' })
  async getBusinessLicenses(@Query() businessLicenseQueryDto: BusinessLicenseQueryDto) {
    return this.businessLicensesService.getBusinessLicenses({
      businessLicenseQueryDto,
    });
  }

  // 사업자 등록 정보 상세 조회 기능
  @Get(':id')
  @RequireScopes('master', 'admin:users:read')
  @ApiOperation({
    summary: '사업자 등록 상세 조회',
    description: '특정 사업자 등록 신청의 상세 정보를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '사업자 등록 ID' })
  @ApiResponse({ status: 200, description: '사업자 등록 상세 조회 성공' })
  async getBusinessLicenseById(@Param('id') id: string) {
    return this.businessLicensesService.getBusinessLicenseByBusinessLicenseId(id);
  }

  @Put(':businessId')
  @RequireScopes('master', 'admin:users:modify')
  @ApiOperation({
    summary: '사업자 등록 정보 수정',
    description: '사업자 등록 신청 정보를 수정하고 상태를 변경합니다.',
  })
  @ApiParam({ name: 'id', description: '사업자 등록 ID' })
  @ApiResponse({ status: 200, description: '사업자 등록 정보 수정 성공' })
  @ApiResponse({ status: 404, description: '사업자 등록 정보를 찾을 수 없음' })
  async updateBusinessLicenseById(
    @Param('businessId') businessId: string,
    @Body()
    updateBusinessLicenseDto: BusinessAdminUpdateDto,
  ) {
    return this.businessLicensesService.updateBusinessLicenseByBusinessId(businessId, updateBusinessLicenseDto);
  }

  @Delete(':id')
  @RequireScopes('master', 'admin:users:archive', 'admin:users:purge')
  @ApiOperation({
    summary: '사업자 등록 정보 삭제',
    description: '사업자 등록 신청 정보를 삭제합니다.',
  })
  @ApiParam({ name: 'id', description: '사업자 등록 ID' })
  @ApiResponse({ status: 200, description: '사업자 등록 정보 삭제 성공' })
  @ApiResponse({ status: 404, description: '사업자 등록 정보를 찾을 수 없음' })
  async deleteBusinessLicenseById(@Param('id') id: string) {
    return this.businessLicensesService.deleteBusinessLicenseById(id);
  }
}
