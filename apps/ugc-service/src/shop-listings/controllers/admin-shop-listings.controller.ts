import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireScopes, User } from '@app/authorization';
import {
  AdminShopListingDetailResponseDto,
  AdminShopListingDto,
  AdminShopListingListQueryDto,
  AdminShopListingResponseDto,
  ModerateShopListingDto,
  RejectShopListingDto,
} from '../dto';
import { ShopListingsService } from '../shop-listings.service';

@ApiTags('Shop Listings (admin)')
@ApiBearerAuth()
@Controller('admin/shop-listings')
export class AdminShopListingsController {
  constructor(private readonly service: ShopListingsService) {}

  @Get()
  @RequireScopes('admin:ugc:read')
  @ApiOperation({ summary: '매물 목록 (관리자)', description: 'status=pending 이면 제출 오래된 순' })
  @ApiResponse({ status: 200, type: [AdminShopListingResponseDto] })
  list(@Query() query: AdminShopListingListQueryDto): Promise<AdminShopListingResponseDto[]> {
    return this.service.listForAdmin(query);
  }

  @Get(':id')
  @RequireScopes('admin:ugc:read')
  @ApiOperation({ summary: '매물 상세 + 판정 이력 (관리자)' })
  @ApiResponse({ status: 200, type: AdminShopListingDetailResponseDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminShopListingDetailResponseDto> {
    return this.service.getForAdmin(id);
  }

  @Post()
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '매물 등록 (관리자) — 바로 게시' })
  @ApiBody({ type: AdminShopListingDto })
  @ApiResponse({ status: 201, type: AdminShopListingResponseDto })
  create(@Body() dto: AdminShopListingDto, @User('userId') adminId: string): Promise<AdminShopListingResponseDto> {
    return this.service.createByAdmin(dto, adminId);
  }

  @Put(':id')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '매물 수정 (관리자) — 상태 유지' })
  @ApiBody({ type: AdminShopListingDto })
  @ApiResponse({ status: 200, type: AdminShopListingResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminShopListingDto,
    @User('userId') adminId: string,
  ): Promise<AdminShopListingResponseDto> {
    return this.service.updateByAdmin(id, dto, adminId);
  }

  @Post(':id/approve')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '승인', description: 'expectedSubmittedAt 이 지금 글과 다르면 409 — 그사이 회원이 고쳤다' })
  @ApiBody({ type: ModerateShopListingDto, required: false })
  @ApiResponse({ status: 201, type: AdminShopListingResponseDto })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerateShopListingDto,
    @User('userId') adminId: string,
  ): Promise<AdminShopListingResponseDto> {
    return this.service.approve(id, dto, adminId);
  }

  @Post(':id/reject')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '거절 (사유 필수)' })
  @ApiBody({ type: RejectShopListingDto })
  @ApiResponse({ status: 201, type: AdminShopListingResponseDto })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectShopListingDto,
    @User('userId') adminId: string,
  ): Promise<AdminShopListingResponseDto> {
    return this.service.reject(id, dto, adminId);
  }

  @Post(':id/hide')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '숨김' })
  @ApiResponse({ status: 201, type: AdminShopListingResponseDto })
  hide(@Param('id', ParseUUIDPipe) id: string, @User('userId') adminId: string): Promise<AdminShopListingResponseDto> {
    return this.service.hide(id, adminId);
  }

  @Post(':id/unhide')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '숨김 해제' })
  @ApiResponse({ status: 201, type: AdminShopListingResponseDto })
  unhide(@Param('id', ParseUUIDPipe) id: string, @User('userId') adminId: string): Promise<AdminShopListingResponseDto> {
    return this.service.unhide(id, adminId);
  }

  @Post(':id/close')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '거래완료로 표시 (관리자)' })
  @ApiResponse({ status: 201, type: AdminShopListingResponseDto })
  close(@Param('id', ParseUUIDPipe) id: string, @User('userId') adminId: string): Promise<AdminShopListingResponseDto> {
    return this.service.setDealStatusByAdmin(id, 'close', adminId);
  }

  @Post(':id/reopen')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '거래완료 해제 (관리자)' })
  @ApiResponse({ status: 201, type: AdminShopListingResponseDto })
  reopen(@Param('id', ParseUUIDPipe) id: string, @User('userId') adminId: string): Promise<AdminShopListingResponseDto> {
    return this.service.setDealStatusByAdmin(id, 'reopen', adminId);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '매물 삭제 (관리자)' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @User('userId') adminId: string): Promise<void> {
    await this.service.deleteByAdmin(id, adminId);
  }
}
