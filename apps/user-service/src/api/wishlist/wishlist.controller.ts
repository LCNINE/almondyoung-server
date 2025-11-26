import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { User } from 'apps/user-service/database/drizzle/schema';
import { WishlistService } from './wishlist.service';
import { AddToWishlistDto } from './dto/wishlist.dto';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';

@ApiTags('찜하기')
@ApiBearerAuth('access-token')
@Controller('wishlist')
export class WishlistController {
  constructor(private readonly wishlistService: WishlistService) { }

  @ApiOperation({
    summary: '상품 찜하기 토글',
    description:
      '사용자가 특정 상품을 위시리스트에 추가/제거합니다. 이미 찜한 상품이면 제거하고, 찜하지 않은 상품이면 추가합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '찜하기 토글 성공',
    schema: {
      examples: {
        added: {
          summary: '찜 목록에 추가됨',
          value: {
            action: 'added',
            message: '찜 목록에 추가되었습니다.',
            data: {
              id: 'wish_01H9ZRXKJ123456789',
              userId: 'user_01H9ZRXKJ123456789',
              productId: 'prod_01H9ZRXKJ123456789',
              createdAt: '2024-01-01T00:00:00.000Z',
            },
          },
        },
        removed: {
          summary: '찜 목록에서 제거됨',
          value: {
            action: 'removed',
            message: '찜 목록에서 제거되었습니다.',
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: '인증되지 않은 사용자' })
  @ApiResponse({ status: 400, description: '잘못된 요청 (상품 ID 누락 등)' })
  @Post()
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async toggleWishlist(
    @CurrentUser() user: User,
    @Body() addToWishlistDto: AddToWishlistDto,
  ) {
    return this.wishlistService.toggleWishlist(user.id, addToWishlistDto);
  }

  @ApiOperation({
    summary: '찜 목록 조회',
    description:
      '사용자의 전체 위시리스트를 조회합니다. 최신순으로 정렬됩니다.',
  })
  @ApiResponse({
    status: 200,
    description: '찜 목록 조회 성공',
    schema: {
      example: [
        {
          id: 'wish_01H9ZRXKJ123456789',
          userId: 'user_01H9ZRXKJ123456789',
          productId: 'prod_01H9ZRXKJ123456789',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    },
  })
  @ApiResponse({ status: 401, description: '인증되지 않은 사용자' })
  @Get()
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async getWishlist(@CurrentUser() user: User) {
    return this.wishlistService.getWishlistByUserId(user.id);
  }

}
