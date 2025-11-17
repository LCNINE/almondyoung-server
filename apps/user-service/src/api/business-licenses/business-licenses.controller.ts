import { AuthorizationGuard, JwtPayload, RequireScopes } from '@app/roles';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../commons/guards/jwt-auth.guard';
import { BusinessLicensesService } from './business-licenses.service';
import {
  BusinessLicenseResponseDto,
  FetchBusinessLicenseResponseDto,
} from './dto/business-license.response.dto';
import {
  CreateBusinessLicenseWithFileDto,
  FetchBusinessLicenseDto,
} from './dto/create-business-license.dto';
import { UpdateBusinessLicenseDto } from './dto/update-business-license.dto';

@ApiTags('사업자 등록 관리')
@ApiBearerAuth('access-token')
@Controller('business-licenses')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class BusinessLicensesController {
  constructor(
    private readonly businessLicensesService: BusinessLicensesService,
  ) {}

  @Get('/:userId')
  @ApiOperation({
    summary: '사용자의 사업자 등록 정보 조회',
    description: '사용자의 사업자 등록 정보를 조회합니다.',
  })
  @ApiParam({ name: 'userId', description: '사용자 ID' })
  @ApiResponse({ status: 200, description: '사업자 등록 정보 조회 성공' })
  @ApiResponse({ status: 401, description: '인증되지 않은 사용자' })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @RequireScopes(['user:read'])
  async getBusinessLicensesByUserId(
    @Param('userId') userId: string,
  ): Promise<BusinessLicenseResponseDto | null> {
    return this.businessLicensesService.getBusinessLicensesByUserId(userId);
  }

  @ApiOperation({
    summary: '사업자 정보 외부 조회',
    description: '사용자의 사업자 정보를 외부에서 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '사업자 등록 정보 조회 성공',
    type: FetchBusinessLicenseResponseDto,
  })
  @ApiResponse({ status: 401, description: '인증되지 않은 사용자' })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @Post('fetch')
  @RequireScopes(['user:read'])
  async fetchBusinessLicense(
    @Body() fetchBusinessLicenseDto: FetchBusinessLicenseDto,
  ) {
    return this.businessLicensesService.fetchBusinessLicense(
      fetchBusinessLicenseDto,
    );
  }

  /**
   * 파일로 사업자 등록요청할 때 사용
   */
  @Post('with-file')
  @ApiOperation({ summary: '파일로 사업자 등록요청' })
  @ApiResponse({ status: 201, description: '파일로 사업자 등록요청 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  @ApiResponse({ status: 401, description: '인증되지 않은 사용자' })
  @ApiResponse({
    status: 409,
    description: '이미 해당 사용자에 대한 사업자 등록 정보가 존재합니다.',
  })
  @RequireScopes(['user:modify'])
  async createWithFile(
    @Body() data: CreateBusinessLicenseWithFileDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.businessLicensesService.createWithFile(data, user.id);
  }

  @ApiOperation({
    summary: '사업자 등록 정보 수정',
    description: '기존 사업자 등록 정보를 수정합니다.',
  })
  @ApiParam({ name: 'business-license-id', description: '사업자 등록 정보 ID' })
  @ApiBody({ type: UpdateBusinessLicenseDto })
  @ApiResponse({
    status: 200,
    description: '사업자 등록 정보 수정 성공',
    type: BusinessLicenseResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  @ApiResponse({ status: 401, description: '인증되지 않은 사용자' })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @ApiResponse({ status: 404, description: '사업자 등록 정보를 찾을 수 없음' })
  @Put(':business-license-id')
  @RequireScopes(['user:modify'])
  async updateBusinessLicenseByBusinessLicenseId(
    @Param('business-license-id') businessLicenseId: string,
    @Body() data: UpdateBusinessLicenseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.businessLicensesService.updateBusinessLicenseByBusinessLicenseId(
      businessLicenseId,
      data,
      user.id,
    );
  }

  @ApiOperation({
    summary: '사업자 등록 정보 삭제',
    description: '사업자 등록 정보를 삭제합니다.',
  })
  @ApiParam({ name: 'business-license-id', description: '사업자 등록 정보 ID' })
  @ApiResponse({ status: 200, description: '사업자 등록 정보 삭제 성공' })
  @ApiResponse({ status: 401, description: '인증되지 않은 사용자' })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @ApiResponse({ status: 404, description: '사업자 등록 정보를 찾을 수 없음' })
  @Delete(':id')
  @RequireScopes(['user:delete'])
  async removeBusinessLicense(
    @Param('id') businessLicenseId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.businessLicensesService.removeBusinessLicense(
      businessLicenseId,
      user.id,
    );
  }
}
