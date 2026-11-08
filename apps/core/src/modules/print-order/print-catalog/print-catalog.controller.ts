import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionCheckpoints, RequirePermission, User } from '@app/authorization';
import {
  PrintKindParamDto,
  PrintQuotesBodyDto,
  PrintSizeQueryDto,
  PublishPrintProductDto,
} from './dto/print-catalog.dto';
import { PrintCatalogService } from './print-catalog.service';

const PUBLISH_DENIED = '템플릿 상품을 게시하려면 가격 변경과 아몬드템플릿 관리 권한도 필요합니다.';

@ApiTags('Admin - Print Catalog')
@Controller('admin/print-catalog')
export class PrintCatalogController {
  constructor(
    private readonly service: PrintCatalogService,
    private readonly checkpoints: PermissionCheckpoints,
  ) {}

  @RequirePermission('marketing.almond_template.write')
  @Get(':kind/options')
  @ApiOperation({ summary: '인쇄 종류별 와우프레스 선택 옵션' })
  options(@Param() { kind }: PrintKindParamDto, @Query() size: PrintSizeQueryDto) {
    return this.service.options(kind, { width: size.width, height: size.height });
  }

  @RequirePermission('marketing.almond_template.write')
  @Post(':kind/quotes')
  @ApiOperation({ summary: '옵션 조합별 와우프레스 실제 원가 견적' })
  quotes(@Param() { kind }: PrintKindParamDto, @Body() body: PrintQuotesBodyDto) {
    return this.service.quotes(kind, { width: body.width, height: body.height }, body.combos);
  }

  // 데코레이터는 한 키만 받으므로 가격·템플릿 권한은 핸들러에서 따로 확인한다
  @RequirePermission('catalog.product.write')
  @Post('publish')
  @HttpCode(200)
  @ApiOperation({ summary: '아몬드템플릿을 판매 상품으로 게시(이미 게시했으면 기존 상품을 돌려준다)' })
  publish(@Body() body: PublishPrintProductDto, @User() user: { userId: string; roles?: string[] }) {
    const subject = { roles: user.roles ?? [] };
    const canPrice = this.checkpoints.check('print_catalog.publish', subject, ['catalog.price.write']);
    const canTemplate = this.checkpoints.check('print_catalog.publish', subject, ['marketing.almond_template.write']);

    if (!canPrice || !canTemplate) {
      throw new ForbiddenException(PUBLISH_DENIED);
    }

    return this.service.publish(body, user.userId);
  }
}
