import {
  Controller,
  Post,
  Get,
  UseInterceptors,
  UploadedFile,
  Body,
  Query,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiQuery, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ProductCsvService } from './product-csv.service';

@ApiTags('Product CSV')
@Controller('products/csv')
export class ProductCsvController {
  constructor(private readonly csvService: ProductCsvService) {}

  @Get('template')
  @ApiOperation({
    summary: 'CSV 템플릿 다운로드',
    description: '제품 일괄 등록을 위한 CSV 템플릿 파일을 다운로드합니다.',
  })
  @ApiResponse({
    status: 200,
    description: 'CSV 템플릿 파일 다운로드 성공',
    headers: {
      'Content-Type': {
        description: 'text/csv; charset=utf-8',
        schema: { type: 'string' },
      },
      'Content-Disposition': {
        description: 'attachment; filename=product-import-template.csv',
        schema: { type: 'string' },
      },
    },
  })
  async downloadTemplate(@Res() res: Response) {
    const csv = this.csvService.generateTemplate();

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=product-import-template.csv');
    res.send(csv);
  }

  @Post('bulk-import')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'CSV 파일로 제품 일괄 등록',
    description: 'CSV 파일을 업로드하여 여러 제품을 한 번에 등록합니다.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'CSV 파일 (product-import-template.csv 형식)',
        },
        userId: {
          type: 'string',
          description: '작업을 수행하는 사용자 ID',
        },
      },
      required: ['file', 'userId'],
    },
  })
  @ApiResponse({
    status: 200,
    description: '제품 일괄 등록 성공',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        imported: { type: 'number' },
        failed: { type: 'number' },
        errors: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: '파일이 없거나 userId가 없음' })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async bulkImport(@UploadedFile() file: Express.Multer.File, @Body('userId') userId: string) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const csvContent = file.buffer.toString('utf-8');
    const csvData = await this.csvService.parseCsv(csvContent);

    return this.csvService.importProducts(csvData, userId);
  }

  @Get('export')
  @ApiOperation({
    summary: '제품 목록 CSV 내보내기',
    description: '제품 목록을 CSV 파일로 내보냅니다. productIds를 지정하면 해당 제품만, 없으면 전체 제품을 내보냅니다.',
  })
  @ApiQuery({
    name: 'productIds',
    required: false,
    type: String,
    description: '내보낼 제품 ID 목록 (쉼표로 구분)',
    example: '550e8400-e29b-41d4-a716-446655440000,6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  })
  @ApiResponse({
    status: 200,
    description: 'CSV 파일 다운로드 성공',
    headers: {
      'Content-Type': {
        description: 'text/csv; charset=utf-8',
        schema: { type: 'string' },
      },
      'Content-Disposition': {
        description: 'attachment; filename=products-export-YYYY-MM-DD.csv',
        schema: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 500, description: '서버 오류' })
  async exportProducts(@Query('productIds') productIds: string, @Res() res: Response) {
    const ids = productIds ? productIds.split(',').filter(Boolean) : undefined;
    const csv = await this.csvService.exportProducts(ids);

    const filename = `products-export-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(csv);
  }
}
