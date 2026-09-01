import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Logger,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductIndexService } from './product-index.service';
import { UpdateSalesCountsDto, UpdateSalesCountsResponseDto } from './dto/update-sales-counts.dto';

/**
 * Medusa 가 누적 판매 수량을 밀어 넣는 내부 라우트.
 *
 * 판매 데이터는 Medusa `product_sort_index` 에만 있고 Kafka 로 나오지 않는다. Medusa 는
 * 이미 membership 의 `internal/*` 를 Bearer 키로 부르고 있어서 같은 방식을 그대로 쓴다.
 * SEARCH_INTERNAL_KEY 가 비어 있으면 라우트를 아예 잠근다 — 설정 누락이 무인증 쓰기가 되면 안 된다.
 */
@Controller('search/products/internal')
export class InternalSalesController {
  private readonly logger = new Logger(InternalSalesController.name);
  private readonly internalKey: string | undefined;

  constructor(
    private readonly productIndexService: ProductIndexService,
    configService: ConfigService,
  ) {
    this.internalKey = configService.get<string>('SEARCH_INTERNAL_KEY');
  }

  @Post('sales-counts')
  async updateSalesCounts(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: UpdateSalesCountsDto,
  ): Promise<UpdateSalesCountsResponseDto> {
    if (!this.internalKey) {
      throw new ForbiddenException('SEARCH_INTERNAL_KEY not configured');
    }
    if (authorization !== `Bearer ${this.internalKey}`) {
      throw new ForbiddenException('Invalid internal key');
    }
    if (dto.items.length === 0) {
      throw new BadRequestException('items is empty');
    }

    const applied = await this.productIndexService.updateProductSalesCounts(
      dto.items.map((item) => ({ masterId: item.masterId, salesCount: item.salesCount })),
    );
    this.logger.log(`sales-counts: ${applied}/${dto.items.length} applied`);

    return { received: dto.items.length, applied };
  }
}
