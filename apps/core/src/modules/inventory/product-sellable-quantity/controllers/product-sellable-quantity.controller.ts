import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ProductSellableQuantityDto } from '../dto/product-sellable-quantity.dto';
import { ProductSellableQuantityService } from '../services/product-sellable-quantity.service';

@ApiTags('Inventory')
@Controller('inventory/product-sellable-quantities')
export class ProductSellableQuantityController {
  constructor(private readonly productSellableQuantity: ProductSellableQuantityService) {}

  @Get('/variants/:variantId')
  @ApiOperation({
    summary: '판매상품 variant 판매가능수량 projection 조회',
    description:
      'Core product matching과 SKU available quantity를 사용해 판매상품 variant 단위 판매가능수량을 계산합니다. 채널별 재고 배분은 하지 않습니다.',
  })
  @ApiParam({ name: 'variantId', description: 'Core catalog variant ID' })
  @ApiResponse({ status: 200, type: ProductSellableQuantityDto })
  async getByVariantId(@Param('variantId') variantId: string): Promise<ProductSellableQuantityDto> {
    return this.productSellableQuantity.getByVariantId(variantId);
  }
}
