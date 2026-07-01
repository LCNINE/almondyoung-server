import { RequireScopes, JwtPayload } from '@app/authorization';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BusinessLicensesService } from './business-licenses.service';
import {
  CreateBusinessLicenseDto,
  FetchBusinessLicenseDto,
  FillBusinessNumberDto,
  UpdateBusinessLicenseDto,
} from './dto/business-license.dto';
import { BusinessLicenseResponseDto } from './dto/business-license.response.dto';

@ApiTags('사업자 등록 관리')
@ApiBearerAuth('access-token')
@Controller('business-licenses')
export class BusinessLicensesController {
  constructor(private readonly businessLicensesService: BusinessLicensesService) {}

  @Post()
  @ApiOperation({
    summary: '사업자 등록',
    description: '사업자 등록을 생성합니다.',
  })
  @ApiBody({ type: CreateBusinessLicenseDto })
  @ApiResponse({ status: 201, description: '사업자 등록 생성 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  @ApiResponse({ status: 401, description: '인증되지 않은 사용자' })
  @ApiResponse({ status: 409, description: '이미 해당 사용자에 대한 사업자 등록 정보가 존재합니다.' })
  @RequireScopes('user:modify')
  async createBusinessLicense(@Body() data: CreateBusinessLicenseDto, @CurrentUser() user: JwtPayload) {
    return this.businessLicensesService.createBusinessLicense(user.id, data);
  }

  @Get('/me')
  @ApiOperation({
    summary: '현재 사용자의 사업자 등록 정보 조회',
    description: '현재 사용자의 사업자 등록 정보를 조회합니다.',
  })
  @ApiParam({ name: 'userId', description: '사용자 ID' })
  @ApiResponse({ status: 200, description: '사업자 등록 정보 조회 성공' })
  @ApiResponse({ status: 401, description: '인증되지 않은 사용자' })
  @ApiResponse({ status: 403, description: '권한 없음' })
  async getMyBusinessLicense(@CurrentUser() user: JwtPayload): Promise<BusinessLicenseResponseDto | null> {
    return this.businessLicensesService.getMyBusinessLicense(user.id);
  }

  @Patch('/me/business-number')
  @ApiOperation({
    summary: '내 사업자번호 채우기 (비어있을 때만)',
    description:
      '이미지로만 등록해 사업자번호가 비어있는 경우(#485), 결제 시 입력한 번호를 본인 사업자정보에 채운다. ' +
      '이미 번호가 있으면 덮어쓰지 않는다. wallet-web 등 RP 가 호출하므로 self-scope(스코프 없음).',
  })
  @ApiBody({ type: FillBusinessNumberDto })
  @ApiResponse({ status: 200, description: '{ saved: boolean } — 실제 저장 여부' })
  async fillMyBusinessNumber(
    @Body() dto: FillBusinessNumberDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ saved: boolean }> {
    return this.businessLicensesService.fillMyBusinessNumberIfEmpty(user.id, dto.businessNumber);
  }

  @ApiOperation({
    summary: '사업자 정보 외부 조회',
    description: '사용자의 사업자 정보를 외부에서 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '사업자 등록 정보 조회 성공',
  })
  @ApiResponse({ status: 401, description: '인증되지 않은 사용자' })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @Post('fetch')
  @RequireScopes('user:read')
  async fetchBusinessLicense(@Body() fetchBusinessLicenseDto: FetchBusinessLicenseDto) {
    return this.businessLicensesService.fetchBusinessLicense(fetchBusinessLicenseDto);
  }

  @ApiOperation({
    summary: '사업자 등록 정보 수정',
    description: '기존 사업자 등록 정보를 수정합니다.',
  })
  @ApiParam({ name: 'businessId', description: '사업자 등록 정보 ID' })
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
  @Put(':businessId')
  @RequireScopes('user:modify')
  async updateBusinessLicenseByBusinessId(
    @Param('businessId') businessId: string,
    @Body() data: UpdateBusinessLicenseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.businessLicensesService.updateBusinessLicenseByBusinessId(businessId, data, user.id);
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
  @RequireScopes('user:delete')
  async removeBusinessLicense(@Param('id') businessLicenseId: string, @CurrentUser() user: JwtPayload) {
    return this.businessLicensesService.removeBusinessLicense(businessLicenseId, user.id);
  }
}
