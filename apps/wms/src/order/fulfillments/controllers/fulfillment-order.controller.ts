import { Controller, Get, Post, Put, Delete, Body, Param, Query, UsePipes } from '@nestjs/common';
import { FulfillmentOrderTransactionService } from '../../shared/services/fulfillment-order-transaction.service';
import { ProductSkuMappingService } from '../../shared/services/product-sku-mapping.service';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';

const CreateFulfillmentOrderSchema = z.object({
  warehouseId: z.string().uuid(),
  fulfillmentMode: z.enum(['in_house', '3pl', 'drop_ship']),
  priority: z.enum(['normal', 'high', 'urgent']).default('normal'),
  items: z.array(z.object({
    salesOrderId: z.string(),
    salesOrderLineId: z.string(),
    productId: z.string(),
    variantId: z.string(),
    qty: z.number().int().positive()
  })).min(1)
});

const UpdatePrioritySchema = z.object({
  priority: z.enum(['normal', 'high', 'urgent'])
});

const AllocateToBatchSchema = z.object({
  batchId: z.string().uuid()
});

const CreateMappingSchema = z.object({
  productId: z.string(),
  variantId: z.string(),
  skuId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quantity: z.number().int().positive().default(1)
});

const AddVariantToMappingSchema = z.object({
  productId: z.string(),
  warehouseId: z.string().uuid(),
  variantId: z.string(),
  skuId: z.string().uuid(),
  quantity: z.number().int().positive().default(1)
});

@Controller('wms/fulfillment-orders')
export class FulfillmentOrderController {
  constructor(
    private readonly fulfillmentOrderTransactionService: FulfillmentOrderTransactionService,
    private readonly productSkuMappingService: ProductSkuMappingService
  ) {}

  @Post()
  @UsePipes(new ZodValidationPipe(CreateFulfillmentOrderSchema))
  async createFulfillmentOrder(@Body() dto: z.infer<typeof CreateFulfillmentOrderSchema>) {
    return this.fulfillmentOrderTransactionService.createFulfillmentOrder(dto);
  }

  @Delete(':id')
  async cancelFulfillmentOrder(@Param('id') fulfillmentOrderId: string) {
    await this.fulfillmentOrderTransactionService.cancelFulfillmentOrder(fulfillmentOrderId);
    return { message: 'Fulfillment order canceled successfully' };
  }

  @Put(':id/priority')
  @UsePipes(new ZodValidationPipe(UpdatePrioritySchema))
  async updatePriority(
    @Param('id') fulfillmentOrderId: string,
    @Body() dto: z.infer<typeof UpdatePrioritySchema>
  ) {
    await this.fulfillmentOrderTransactionService.updateFulfillmentOrderPriority(fulfillmentOrderId, dto.priority);
    return { message: 'Priority updated successfully' };
  }

  @Post(':id/allocate')
  @UsePipes(new ZodValidationPipe(AllocateToBatchSchema))
  async allocateToOutboundBatch(
    @Param('id') fulfillmentOrderId: string,
    @Body() dto: z.infer<typeof AllocateToBatchSchema>
  ) {
    await this.fulfillmentOrderTransactionService.allocateToOutboundBatch(fulfillmentOrderId, dto.batchId);
    return { message: 'Allocated to outbound batch successfully' };
  }
}

@Controller('wms/product-sku-mappings')
export class ProductSkuMappingController {
  constructor(
    private readonly productSkuMappingService: ProductSkuMappingService
  ) {}

  @Post()
  @UsePipes(new ZodValidationPipe(CreateMappingSchema))
  async createMapping(@Body() dto: z.infer<typeof CreateMappingSchema>) {
    await this.productSkuMappingService.createMapping(dto);
    return { message: 'Product-SKU mapping created successfully' };
  }

  @Get(':productId/:warehouseId')
  async getActiveMapping(
    @Param('productId') productId: string,
    @Param('warehouseId') warehouseId: string
  ) {
    return this.productSkuMappingService.getActiveMapping(productId, warehouseId);
  }

  @Get(':productId/:warehouseId/history')
  async getMappingHistory(
    @Param('productId') productId: string,
    @Param('warehouseId') warehouseId: string
  ) {
    return this.productSkuMappingService.getMappingHistory(productId, warehouseId);
  }

  @Post('variants')
  @UsePipes(new ZodValidationPipe(AddVariantToMappingSchema))
  async addVariantToMapping(@Body() dto: z.infer<typeof AddVariantToMappingSchema>) {
    await this.productSkuMappingService.addVariantToMapping(
      dto.productId,
      dto.warehouseId,
      dto.variantId,
      dto.skuId,
      dto.quantity
    );
    return { message: 'Variant added to mapping successfully' };
  }

  @Delete(':productId/:warehouseId/variants/:variantId')
  async removeVariantFromMapping(
    @Param('productId') productId: string,
    @Param('warehouseId') warehouseId: string,
    @Param('variantId') variantId: string
  ) {
    await this.productSkuMappingService.removeVariantFromMapping(productId, warehouseId, variantId);
    return { message: 'Variant removed from mapping successfully' };
  }

  @Get('variants/:variantId/:warehouseId/sku-mapping')
  async getSkuMappingForVariant(
    @Param('variantId') variantId: string,
    @Param('warehouseId') warehouseId: string
  ) {
    return this.productSkuMappingService.getSkuMappingForVariant(variantId, warehouseId);
  }

  @Get(':productId/:warehouseId/validate')
  async validateMapping(
    @Param('productId') productId: string,
    @Param('warehouseId') warehouseId: string
  ) {
    const isValid = await this.productSkuMappingService.validateMapping(productId, warehouseId);
    return { isValid };
  }
}