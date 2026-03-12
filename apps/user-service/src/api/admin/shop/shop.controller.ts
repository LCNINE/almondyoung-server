import { RequireScopes } from '@app/authorization';
import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { ShopResponseDto } from 'apps/user-service/src/commons/dto/shop.dto';
import { ShopService } from './shop.service';

@Controller('admin/shops')
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @Get('/:userId')
  @RequireScopes('master', 'admin:users:read')
  @ApiOperation({
    summary: '사용자 상점 정보 조회',
    description: '사용자의 상점 정보를 조회합니다.',
  })
  @ApiParam({ name: 'userId', description: '사용자 ID' })
  @ApiResponse({
    status: 200,
    description: '사용자 상점 정보 조회 성공',
    type: ShopResponseDto,
  })
  async getShopInfoByUserId(
    @Param('userId') userId: string,
  ): Promise<ShopResponseDto | null> {
    return this.shopService.getShopInfoByUserId(userId);
  }
}
