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
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ProductCsvService } from '../services/product-csv.service';

@Controller('api/pim/products')
export class ProductCsvController {
  constructor(private readonly csvService: ProductCsvService) {}

  @Get('csv/template')
  async downloadTemplate(@Res() res: Response) {
    const csv = this.csvService.generateTemplate();

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=product-import-template.csv',
    );
    res.send(csv);
  }

  @Post('bulk-import')
  @UseInterceptors(FileInterceptor('file'))
  async bulkImport(
    @UploadedFile() file: Express.Multer.File,
    @Body('userId') userId: string,
  ) {
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
  async exportProducts(
    @Query('productIds') productIds: string,
    @Res() res: Response,
  ) {
    const ids = productIds
      ? productIds.split(',').filter(Boolean)
      : undefined;
    const csv = await this.csvService.exportProducts(ids);

    const filename = `products-export-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(csv);
  }
}

