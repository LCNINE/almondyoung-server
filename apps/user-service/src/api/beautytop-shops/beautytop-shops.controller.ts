import { BadRequestError } from '@app/shared';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { User } from 'apps/user-service/database/drizzle/schema';
import { BeautytopShopsService } from './beautytop-shops.service';
import { BeautytopShopDto, SetMyShopDto, SHOP_KINDS } from './dto/beautytop-shops.dto';

/** 로그인한 본인의 뷰티탑 «내 샵»·관심 샵. 대상 사용자는 토큰에서만 정한다. */
@ApiTags('뷰티탑 저장 샵')
@ApiBearerAuth('access-token')
@Controller('beautytop/shops')
@UseGuards(AuthGuard('jwt'))
export class BeautytopShopsController {
  constructor(private readonly service: BeautytopShopsService) {}

  @ApiOperation({ summary: '내 샵과 관심 샵 조회' })
  @Get()
  list(@CurrentUser() user: User) {
    return this.service.list(user.id);
  }

  @ApiOperation({ summary: '내 샵 지정(null 이면 해제)' })
  @Put('my-shop')
  setMyShop(@CurrentUser() user: User, @Body() dto: SetMyShopDto) {
    return this.service.setMyShop(user.id, dto.shop ?? null);
  }

  @ApiOperation({ summary: '관심 샵 추가' })
  @Post('watch')
  @HttpCode(HttpStatus.OK)
  addWatch(@CurrentUser() user: User, @Body() dto: BeautytopShopDto) {
    return this.service.addWatch(user.id, dto);
  }

  @ApiOperation({ summary: '관심 샵 삭제' })
  @Delete('watch/:shopKind/:shopId')
  removeWatch(@CurrentUser() user: User, @Param('shopKind') shopKind: string, @Param('shopId') shopId: string) {
    const id = Number(shopId);
    if (!SHOP_KINDS.some((k) => k === shopKind) || !Number.isInteger(id) || id < 1) {
      throw new BadRequestError('잘못된 샵입니다.');
    }
    return this.service.removeWatch(user.id, shopKind, id);
  }
}
