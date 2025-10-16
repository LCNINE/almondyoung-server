import { AuthorizationGuard, RequireScopes } from '@app/roles';
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { ShopResponseDto } from 'apps/user-service/src/commons/dto/shop.dto';
import { JwtAuthGuard } from 'apps/user-service/src/commons/guards/jwt-auth.guard';
import { ShopService } from './shop.service';

@Controller('admin/shops')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @Get('info/:userId')
  @RequireScopes(['master', 'admin:users:read'])
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
