import { RequireScopes } from '@app/authorization';
import { JwtPayload } from '@app/roles';
import { Body, Controller, Get, Patch, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CreateShopInfoDto } from './dto/create-shop-info.dto';
import { ShopService } from './shop.service';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';

@ApiTags('Shop')
@ApiBearerAuth('access-token')
@Controller('shop')
export class ShopController {
  constructor(private readonly shopService: ShopService) { }

  @ApiOperation({ summary: '상점 정보 조회' })
  @ApiResponse({ status: 200, description: '상점 정보 조회 성공' })
  @Get('info')
  @RequireScopes('user:read', 'master')
  findOneByUserId(@CurrentUser() user: JwtPayload) {
    return this.shopService.findOneByUserId(user.id);
  }

  @ApiOperation({ summary: '상점 정보 생성' })
  @ApiResponse({ status: 201, description: '상점 정보 생성 성공' })
  @Post('info')
  @RequireScopes('user:modify', 'master')
  createShopInfo(
    @Body() createShopDto: CreateShopInfoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.shopService.createShopInfo(createShopDto, user.id);
  }

  @ApiOperation({ summary: '상점 정보 수정' })
  @ApiResponse({ status: 200, description: '상점 정보 수정 성공' })
  @Put('info')
  @RequireScopes('user:modify', 'master')
  updateShopInfo(
    @Body() updateShopDto: CreateShopInfoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.shopService.updateShopInfo(updateShopDto, user.id);
  }


  @Patch('remind')
  @RequireScopes('user:modify', 'master')
  async updateRemindAt(@CurrentUser() user: JwtPayload) {
    return this.shopService.updateRemindAt(user.id);
  }

}
