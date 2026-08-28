import { Injectable } from '@nestjs/common';
import { PaginatedResponseDto } from '@app/shared/dto';
import { StockValuationReader } from './stock-valuation.reader';
import {
  GetStockValuationProductsQueryDto,
  StockValuationProductDto,
  StockValuationSummaryDto,
} from '../dto/stock-valuation.dto';

@Injectable()
export class StockValuationService {
  constructor(private readonly reader: StockValuationReader) {}

  async getSummary(): Promise<StockValuationSummaryDto> {
    return this.reader.getSummary();
  }

  async getProducts(query: GetStockValuationProductsQueryDto): Promise<PaginatedResponseDto<StockValuationProductDto>> {
    return this.reader.getProducts(query);
  }
}
