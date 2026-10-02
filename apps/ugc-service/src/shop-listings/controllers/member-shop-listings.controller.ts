import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { MemberShopListingDto, MyShopListingResponseDto } from '../dto';
import { ShopListingsService } from '../shop-listings.service';

/** 로그인 회원 누구나(전역 JwtAuthGuard). 작성자는 토큰에서만 온다 — DTO 에 작성자 필드가 없다. */
@ApiTags('Shop Listings (member)')
@ApiBearerAuth()
@Controller('shop-listings')
export class MemberShopListingsController {
  constructor(private readonly service: ShopListingsService) {}

  @Post()
  @ApiOperation({ summary: '내 매물 등록', description: '검토 대기로 들어간다. 검토 중+게시 중 3건까지.' })
  @ApiBody({ type: MemberShopListingDto })
  @ApiResponse({ status: 201, type: MyShopListingResponseDto })
  @ApiResponse({ status: 409, description: '동시 게시 한도 초과' })
  create(@Body() dto: MemberShopListingDto, @User('userId') userId: string): Promise<MyShopListingResponseDto> {
    return this.service.createByMember(dto, userId);
  }

  @Get('mine')
  @ApiOperation({ summary: '내 매물 목록 (상태·거절 사유 포함)' })
  @ApiResponse({ status: 200, type: [MyShopListingResponseDto] })
  listMine(@User('userId') userId: string): Promise<MyShopListingResponseDto[]> {
    return this.service.listMine(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: '내 매물 단건 (수정 폼용)' })
  @ApiResponse({ status: 200, type: MyShopListingResponseDto })
  @ApiResponse({ status: 404, description: '없거나 내 글이 아님' })
  get(@Param('id', ParseUUIDPipe) id: string, @User('userId') userId: string): Promise<MyShopListingResponseDto> {
    return this.service.getMine(id, userId);
  }

  @Put(':id')
  @ApiOperation({ summary: '내 매물 수정', description: '다시 검토 대기로 내려간다. slug 는 바뀌지 않는다.' })
  @ApiBody({ type: MemberShopListingDto })
  @ApiResponse({ status: 200, type: MyShopListingResponseDto })
  @ApiResponse({ status: 409, description: '숨김 처리된 글 / 한도 초과 / 상태 경합' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MemberShopListingDto,
    @User('userId') userId: string,
  ): Promise<MyShopListingResponseDto> {
    return this.service.updateByMember(id, dto, userId);
  }

  @Post(':id/close')
  @ApiOperation({ summary: '거래완료로 표시' })
  @ApiResponse({ status: 201, type: MyShopListingResponseDto })
  close(@Param('id', ParseUUIDPipe) id: string, @User('userId') userId: string): Promise<MyShopListingResponseDto> {
    return this.service.closeByMember(id, userId);
  }

  @Post(':id/reopen')
  @ApiOperation({ summary: '거래완료 해제' })
  @ApiResponse({ status: 201, type: MyShopListingResponseDto })
  reopen(@Param('id', ParseUUIDPipe) id: string, @User('userId') userId: string): Promise<MyShopListingResponseDto> {
    return this.service.reopenByMember(id, userId);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '내 매물 삭제', description: '연락처는 즉시 지워진다.' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @User('userId') userId: string): Promise<void> {
    await this.service.deleteByMember(id, userId);
  }
}
