import { Controller, Get, Headers, HttpCode, Ip, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@app/authorization';
import { PublicShopListingResponseDto, ShopListingContactResponseDto } from '../dto';
import { ShopListingsService } from '../shop-listings.service';

@ApiTags('Shop Listings (public)')
@Controller('shop-listings/public')
export class PublicShopListingsController {
  constructor(private readonly service: ShopListingsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: '샵 매매 공개 목록', description: 'published·closed 를 최신순으로. 연락처는 없다.' })
  @ApiResponse({ status: 200, type: [PublicShopListingResponseDto] })
  list(): Promise<PublicShopListingResponseDto[]> {
    return this.service.listPublic();
  }

  @Public()
  @Get(':slug')
  @ApiParam({ name: 'slug' })
  @ApiOperation({ summary: '샵 매매 공개 상세' })
  @ApiResponse({ status: 200, type: PublicShopListingResponseDto })
  @ApiResponse({ status: 404 })
  get(@Param('slug') slug: string): Promise<PublicShopListingResponseDto> {
    return this.service.getPublic(slug);
  }

  /**
   * 로그인한 사람에게만. 공개 목록·상세에 섞으면 로그인 여부로 응답이 갈려 스토어프론트의
   * 한 벌 캐시(ADR-0038)를 못 쓴다. 크롤러는 구조적으로 여기 닿지 못한다.
   */
  @Get(':slug/contact')
  @ApiBearerAuth()
  @ApiParam({ name: 'slug' })
  @ApiOperation({ summary: '샵 매매 연락처 (로그인 필요)' })
  @ApiResponse({ status: 200, type: ShopListingContactResponseDto })
  @ApiResponse({ status: 401 })
  @ApiResponse({ status: 404 })
  contact(@Param('slug') slug: string): Promise<ShopListingContactResponseDto> {
    return this.service.getContact(slug);
  }

  @Public()
  @Post(':slug/view')
  @HttpCode(204)
  @ApiParam({ name: 'slug' })
  @ApiOperation({
    summary: '샵 매매 조회수 +1',
    description: '상세 페이지가 캐시된 서버 컴포넌트라 브라우저가 세션당 1회 부른다. 없는 slug 는 조용히 무시한다.',
  })
  @ApiHeader({
    name: 'x-visitor-ip',
    required: false,
    description: '스토어프론트 서버액션이 대신 부르므로 소켓 IP 는 스토어프론트 것이다.',
  })
  async view(
    @Param('slug') slug: string,
    @Headers('x-visitor-ip') visitorIp: string | undefined,
    @Ip() socketIp: string,
  ): Promise<void> {
    await this.service.recordView(slug, visitorIp?.trim() || socketIp);
  }
}
