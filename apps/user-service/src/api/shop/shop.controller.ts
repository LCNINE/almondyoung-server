import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ShopService } from './shop.service';
import { CreateShopInfoDto } from './dto/create-shop-info.dto';
import { UpdateShopInfoDto } from './dto/update-shop-info';
import { JwtAuthGuard } from '../../commons/guards/jwt-auth.guard';
import { CurrentUser } from '../../commons/decorators/current-user.decorator';
import { User } from 'apps/user-service/database/drizzle/schema';

@ApiTags('Shop')
@ApiBearerAuth('access-token')
@Controller('shop')
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @ApiOperation({ summary: '상점 정보 조회' })
  @ApiResponse({ status: 200, description: '상점 정보 조회 성공' })
  @Get('info')
  @UseGuards(JwtAuthGuard)
  findOneByUserId(@CurrentUser() user: User) {
    return this.shopService.findOneByUserId(user.id);
  }

  @ApiOperation({ summary: '상점 정보 생성' })
  @ApiResponse({ status: 201, description: '상점 정보 생성 성공' })
  @Post('info')
  @UseGuards(JwtAuthGuard)
  create(@Body() createShopDto: CreateShopInfoDto, @CurrentUser() user: User) {
    return this.shopService.create(createShopDto, user);
  }

  @ApiOperation({ summary: '상점 정보 수정' })
  @ApiResponse({ status: 200, description: '상점 정보 수정 성공' })
  @Patch(':id/info')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('id') id: string,
    @Body() updateShopDto: UpdateShopInfoDto,
    @CurrentUser() user: User,
  ) {
    return this.shopService.update(id, updateShopDto, user);
  }
}
