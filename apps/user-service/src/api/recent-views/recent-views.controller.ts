import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { User } from 'apps/user-service/database/drizzle/schema';
import { AddToRecentViewsDto } from './dto/recent-views.dto';
import { RecentViewsService } from './recent-views.service';
import { JwtPayload } from '@app/authorization';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';

@ApiTags('최근 본 상품')
@ApiBearerAuth()
@Controller('/recent-views')
export class RecentViewsController {
  constructor(private readonly recentViewsService: RecentViewsService) {}

  @ApiOperation({
    summary: '최근 본 상품 추가',
    description:
      '사용자가 조회한 상품을 최근 본 상품 목록에 추가합니다. 이미 있는 상품의 경우 조회 시간이 업데이트됩니다.',
  })
  @ApiResponse({
    status: 200,
    description: '최근 본 상품 추가 성공',
    schema: {
      example: {
        id: 'recent_01H9ZRXKJ123456789',
        userId: 'user_01H9ZRXKJ123456789',
        productId: 'prod_01H9ZRXKJ123456789',
        viewedAt: '2024-01-01T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: '인증되지 않은 사용자' })
  @ApiResponse({ status: 400, description: '잘못된 요청 (상품 ID 누락 등)' })
  @Post()
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async addToRecentViews(@CurrentUser() user: JwtPayload, @Body() addToRecentViewsDto: AddToRecentViewsDto) {
    return this.recentViewsService.addToRecentViews(user.id, addToRecentViewsDto);
  }

  @ApiOperation({
    summary: '최근 본 상품 목록 조회',
    description:
      '사용자의 최근 본 상품 목록을 조회합니다. 최근 본 순서대로 정렬되며, limit 파라미터로 조회할 개수를 제한할 수 있습니다.',
  })
  @ApiResponse({
    status: 200,
    description: '최근 본 상품 목록 조회 성공',
    schema: {
      example: [
        {
          id: 'recent_01H9ZRXKJ123456789',
          userId: 'user_01H9ZRXKJ123456789',
          productId: 'prod_01H9ZRXKJ123456789',
          viewedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    },
  })
  @ApiResponse({ status: 401, description: '인증되지 않은 사용자' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: '조회할 최대 항목 수 (기본값: 20)',
  })
  @Get()
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async getRecentViews(@CurrentUser() user: JwtPayload, @Query('limit') limit?: string) {
    return this.recentViewsService.getRecentViews(user.id, limit ? parseInt(limit) : 20);
  }

  @ApiOperation({
    summary: '최근 본 상품 제거',
    description: '특정 상품을 최근 본 상품 목록에서 제거합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '최근 본 상품 제거 성공',
    schema: {
      example: {
        success: true,
        message: '최근 본 상품 목록에서 상품이 성공적으로 제거되었습니다.',
      },
    },
  })
  @ApiResponse({ status: 401, description: '인증되지 않은 사용자' })
  @ApiResponse({ status: 404, description: '찾을 수 없는 최근 본 상품' })
  @ApiParam({ name: 'recentViewId', description: 'recent_views 테이블의 id' })
  @Delete(':recentViewId')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async removeFromRecentViews(@CurrentUser() user: JwtPayload, @Param('recentViewId') recentViewId: string) {
    return this.recentViewsService.removeRecentViewByUserIdAndRecentViewId(user.id, recentViewId);
  }
}
