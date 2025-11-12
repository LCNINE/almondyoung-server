import { AuthorizationGuard, JwtPayload, RequireScopes } from '@app/roles';
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../commons/guards/jwt-auth.guard';
import { CreateShopInfoDto } from './dto/create-shop-info.dto';
import { ShopService } from './shop.service';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';

@ApiTags('Shop')
@ApiBearerAuth('access-token')
@Controller('shop')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @ApiOperation({ summary: '상점 정보 조회' })
  @ApiResponse({ status: 200, description: '상점 정보 조회 성공' })
  @Get('info')
  @RequireScopes(['user:read', 'master'])
  findOneByUserId(@CurrentUser() user: JwtPayload) {
    return this.shopService.findOneByUserId(user.id);
  }

  @ApiOperation({ summary: '상점 정보 생성 및 수정' })
  @ApiResponse({ status: 201, description: '상점 정보 생성 성공' })
  @Post('info')
  @RequireScopes(['user:modify', 'master'])
  modify(
    @Body() createShopDto: CreateShopInfoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.shopService.modify(createShopDto, user.id);
  }
}
