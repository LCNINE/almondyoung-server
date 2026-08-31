import { Public, RolesGuard, User } from '@app/authorization';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateShopListingDto, ShopListingListQueryDto, ShopListingResponseDto, UpdateShopListingDto } from './dto';
import { ShopListingsService } from './shop-listings.service';

@ApiTags('Shop Listings')
@Controller('shop-listings')
export class ShopListingsController {
  constructor(private readonly shopListingsService: ShopListingsService) {}

  @Post()
  @UseGuards(RolesGuard('master', 'admin'))
  @ApiBearerAuth()
  @ApiOperation({ summary: '샵매매 글 등록 (관리자)' })
  @ApiBody({ type: CreateShopListingDto })
  @ApiResponse({ status: 201, type: ShopListingResponseDto })
  async create(@Body() dto: CreateShopListingDto, @User() user: { userId: string }): Promise<ShopListingResponseDto> {
    return this.shopListingsService.create(dto, user?.userId);
  }

  @Get()
  @UseGuards(RolesGuard('master', 'admin'))
  @ApiBearerAuth()
  @ApiOperation({ summary: '샵매매 글 목록 조회 (관리자)' })
  @ApiResponse({ status: 200, type: [ShopListingResponseDto] })
  async list(@Query() query: ShopListingListQueryDto): Promise<ShopListingResponseDto[]> {
    return this.shopListingsService.list(query);
  }

  @Public()
  @Get('public')
  @ApiOperation({ summary: '샵매매 글 목록 조회 (스토어프론트)', description: '노출 중인 글만 최신순으로 반환합니다.' })
  @ApiResponse({ status: 200, type: [ShopListingResponseDto] })
  async listPublic(): Promise<ShopListingResponseDto[]> {
    return this.shopListingsService.listPublic();
  }

  @Public()
  @Get('public/:slug')
  @ApiOperation({ summary: '샵매매 글 상세 조회 (스토어프론트)' })
  @ApiParam({ name: 'slug', description: '상세 URL 주소' })
  @ApiResponse({ status: 200, type: ShopListingResponseDto })
  @ApiResponse({ status: 404, description: '글을 찾을 수 없음' })
  async getPublicBySlug(@Param('slug') slug: string): Promise<ShopListingResponseDto> {
    return this.shopListingsService.getPublicBySlug(slug);
  }

  @Public()
  @Post('public/:slug/view')
  @HttpCode(204)
  @ApiOperation({
    summary: '샵매매 글 조회수 +1 (스토어프론트)',
    description:
      '상세 페이지가 캐시된 서버 컴포넌트라 렌더에서 셀 수 없어, 브라우저가 세션당 1회 호출한다. ' +
      '없는 slug 는 조용히 무시한다 (봇이 던진 경로로 404 를 만들지 않기 위함).',
  })
  @ApiParam({ name: 'slug', description: '상세 URL 주소' })
  @ApiHeader({
    name: 'x-visitor-ip',
    required: false,
    description:
      '실제 방문자 IP. 스토어프론트 서버액션이 대신 호출하므로 소켓 IP 는 전부 스토어프론트 것이라 쓸 수 없다.',
  })
  @ApiResponse({ status: 204, description: '기록 완료' })
  async recordPublicView(
    @Param('slug') slug: string,
    @Headers('x-visitor-ip') visitorIp: string | undefined,
    @Ip() socketIp: string,
  ): Promise<void> {
    await this.shopListingsService.recordView(slug, visitorIp?.trim() || socketIp);
  }

  @Get(':id')
  @UseGuards(RolesGuard('master', 'admin'))
  @ApiBearerAuth()
  @ApiOperation({ summary: '샵매매 글 상세 조회 (관리자)' })
  @ApiParam({ name: 'id', description: '샵매매 글 ID' })
  @ApiResponse({ status: 200, type: ShopListingResponseDto })
  @ApiResponse({ status: 404, description: '글을 찾을 수 없음' })
  async getById(@Param('id', ParseUUIDPipe) id: string): Promise<ShopListingResponseDto> {
    return this.shopListingsService.getById(id);
  }

  @Put(':id')
  @UseGuards(RolesGuard('master', 'admin'))
  @ApiBearerAuth()
  @ApiOperation({ summary: '샵매매 글 수정 (관리자)' })
  @ApiParam({ name: 'id', description: '샵매매 글 ID' })
  @ApiBody({ type: UpdateShopListingDto })
  @ApiResponse({ status: 200, type: ShopListingResponseDto })
  @ApiResponse({ status: 404, description: '글을 찾을 수 없음' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShopListingDto,
    @User() user: { userId: string },
  ): Promise<ShopListingResponseDto> {
    return this.shopListingsService.update(id, dto, user?.userId);
  }

  @Delete(':id')
  @UseGuards(RolesGuard('master', 'admin'))
  @ApiBearerAuth()
  @ApiOperation({ summary: '샵매매 글 삭제 (관리자, Soft Delete)' })
  @ApiParam({ name: 'id', description: '샵매매 글 ID' })
  @ApiResponse({ status: 200, description: '삭제 성공' })
  @ApiResponse({ status: 404, description: '글을 찾을 수 없음' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @User() user: { userId: string }): Promise<{ message: string }> {
    await this.shopListingsService.delete(id, user?.userId);
    return { message: 'Shop listing deleted successfully' };
  }
}
