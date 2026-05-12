import { Module } from '@nestjs/common';
import { ProductCsvController } from './product-csv.controller';
import { ProductCsvService } from './product-csv.service';

@Module({
  controllers: [ProductCsvController],
  providers: [ProductCsvService],
  exports: [ProductCsvService],
})
export class CsvModule {}
