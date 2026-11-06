import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@app/authorization';
import { PrintKindParamDto, PrintQuotesBodyDto, PrintSizeQueryDto } from './dto/print-catalog.dto';
import { PrintCatalogService } from './print-catalog.service';

@ApiTags('Admin - Print Catalog')
@Controller('admin/print-catalog')
export class PrintCatalogController {
  constructor(private readonly service: PrintCatalogService) {}

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
}
