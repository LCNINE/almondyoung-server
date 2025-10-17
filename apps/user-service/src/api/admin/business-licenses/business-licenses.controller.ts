import { AuthorizationGuard, RequireScopes } from '@app/roles';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../commons/guards/jwt-auth.guard';
import { UpdateBusinessLicenseDtoWithReviewCommentAndStatus } from '../../business-licenses/dto/update-business-license.dto';
import { BusinessLicensesService } from './business-licenses.service';
import { BusinessLicenseQueryDto } from './dto/pagination-query-dto';

@ApiTags('사업자 등록 관리')
@ApiBearerAuth('access-token')
@Controller('admin/business-licenses')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class BusinessLicensesController {
  constructor(
    private readonly businessLicensesService: BusinessLicensesService,
  ) {}

  @Get()
  @RequireScopes(['master', 'admin:users:read'])
  @ApiOperation({
    summary: '사업자 등록 목록 조회',
    description: '사업자 등록 신청 목록을 페이지네이션하여 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '사업자 등록 목록 조회 성공' })
  async getBusinessLicenses(
    @Query() businessLicenseQueryDto: BusinessLicenseQueryDto,
  ) {
    return this.businessLicensesService.getBusinessLicenses({
      businessLicenseQueryDto,
    });
  }

  // 사업자 등록 정보 상세 조회 기능
  @Get(':id')
  @RequireScopes(['master', 'admin:users:read'])
  @ApiOperation({
    summary: '사업자 등록 상세 조회',
    description: '특정 사업자 등록 신청의 상세 정보를 조회합니다.',
  })
  @ApiParam({ name: 'id', description: '사업자 등록 ID' })
  @ApiResponse({ status: 200, description: '사업자 등록 상세 조회 성공' })
  async getBusinessLicenseById(@Param('id') id: string) {
    return this.businessLicensesService.getBusinessLicenseByBusinessLicenseId(
      id,
    );
  }

  @Put(':id')
  @RequireScopes(['master', 'admin:users:modify'])
  @ApiOperation({
    summary: '사업자 등록 정보 수정',
    description: '사업자 등록 신청 정보를 수정하고 상태를 변경합니다.',
  })
  @ApiParam({ name: 'id', description: '사업자 등록 ID' })
  @ApiResponse({ status: 200, description: '사업자 등록 정보 수정 성공' })
  @ApiResponse({ status: 404, description: '사업자 등록 정보를 찾을 수 없음' })
  async updateBusinessLicenseById(
    @Param('id') id: string,
    @Body()
    updateBusinessLicenseDto: UpdateBusinessLicenseDtoWithReviewCommentAndStatus,
  ) {
    const businessLicenseId = id;

    return this.businessLicensesService.updateBusinessLicenseByBusinessLicenseId(
      businessLicenseId,
      updateBusinessLicenseDto,
    );
  }

  @Delete(':id')
  @RequireScopes(['master', 'admin:users:archive', 'admin:users:purge'])
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
