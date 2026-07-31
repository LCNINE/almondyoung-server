import { Body, Controller, Get, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { EXPORT_COLUMNS, DEFAULT_COLUMN_KEYS } from './product-export.columns';
import { ProductExportService } from './product-export.service';
import { ExportColumnDto, ProductExportRequestDto } from './dto/product-export.dto';

@ApiTags('Product Export')
@Controller('masters/export')
export class ProductExportController {
  constructor(private readonly service: ProductExportService) {}

  @Get('columns')
  @ApiOperation({
    summary: '내보내기 가능 항목 목록',
    description: '양식 편집기가 쓰는 항목 카탈로그. key 는 양식에 저장되는 식별자다.',
  })
  @ApiResponse({ status: 200, type: [ExportColumnDto] })
  getColumns(): { columns: ExportColumnDto[]; defaultKeys: string[] } {
    return {
      columns: EXPORT_COLUMNS.map(({ key, label }) => ({ key, label })),
      defaultKeys: DEFAULT_COLUMN_KEYS,
    };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '상품 목록 엑셀 내보내기',
    description:
      'ids 를 주면 선택항목만, 없으면 filters 로 검색결과 전체를 내보낸다. ' +
      '열 목록이 길어 URL 한계를 넘기므로 GET 이 아니라 POST 다.',
  })
  async export(@Body() dto: ProductExportRequestDto, @Res() reply: FastifyReply): Promise<void> {
    const { stream } = await this.service.export(dto);

    // 파일명은 프록시가 Content-Disposition 을 떨어뜨려도 되도록 프론트가 다시 정한다.
    // 여기 값은 API 를 직접 호출할 때(swagger·curl)를 위한 것이다.
    await reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="products.xlsx"')
      .send(stream);
  }
}
