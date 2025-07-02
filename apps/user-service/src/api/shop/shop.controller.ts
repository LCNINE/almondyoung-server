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
import { ShopService } from './shop.service';
import { CreateShopInfoDto } from './dto/create-shop-info.dto';
import { UpdateShopInfoDto } from './dto/update-shop-info';
import { JwtAuthGuard } from '../../commons/guards/jwt-auth.guard';
import { CurrentUser } from '../../commons/decorators/current-user.decorator';
import { User } from 'apps/user-service/database/drizzle/schema';

@Controller('shop')
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @Get('info')
  @UseGuards(JwtAuthGuard)
  findOneByUserId(@CurrentUser() user: User) {
    return this.shopService.findOneByUserId(user.id);
  }

  @Post('info')
  @UseGuards(JwtAuthGuard)
  create(@Body() createShopDto: CreateShopInfoDto, @CurrentUser() user: User) {
    return this.shopService.create(createShopDto, user);
  }

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
