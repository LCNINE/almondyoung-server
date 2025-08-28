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
import { CurrentUser } from '../../commons/decorators/current-user.decorator';
import { WishlistService } from './wishlist.service';
import { AddToWishlistDto } from './dto/wishlist.dto';

@ApiTags('찜하기')
@ApiBearerAuth('access-token')
@Controller('wishlist')
export class WishlistController {
  constructor(private readonly wishlistService: WishlistService) {}

  @ApiOperation({
    summary: '상품 찜하기',
    description:
      '사용자가 특정 상품을 위시리스트에 추가합니다. 이미 추가된 상품은 중복으로 추가되지 않습니다.',
  })
  @ApiResponse({
    status: 200,
    description: '찜하기 성공',
    schema: {
      example: {
        id: 'wish_01H9ZRXKJ123456789',
        userId: 'user_01H9ZRXKJ123456789',
        productId: 'prod_01H9ZRXKJ123456789',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: '인증되지 않은 사용자' })
  @ApiResponse({ status: 400, description: '잘못된 요청 (상품 ID 누락 등)' })
  @Post()
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async addToWishlist(
    @CurrentUser() user: User,
    @Body() addToWishlistDto: AddToWishlistDto,
  ) {
    return this.wishlistService.addToWishlist(user.id, addToWishlistDto);
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

  @ApiOperation({
    summary: '찜 제거',
    description: '특정 상품을 위시리스트에서 제거합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '찜 제거 성공',
    schema: {
      example: {
        success: true,
        message: '위시리스트에서 상품이 성공적으로 제거되었습니다.',
      },
    },
  })
  @ApiResponse({ status: 401, description: '인증되지 않은 사용자' })
  @ApiResponse({ status: 404, description: '찾을 수 없는 위시리스트 항목' })
  @ApiParam({ name: 'wishlistId', description: '제거할 해당 찜 ID' })
  @Delete(':wishlistId')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async removeFromWishlist(
    @CurrentUser() user: User,
    @Param('wishlistId') wishlistId: string,
  ) {
    return this.wishlistService.removeWishlistByUserIdAndWishlistId(
      user.id,
      wishlistId,
    );
  }
}
