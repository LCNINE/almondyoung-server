import { Controller, Logger, UseFilters, UseInterceptors } from '@nestjs/common';
import { EventEnvelope, EventPayload, OnEvent, EventsExceptionFilter } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import {
  ProductInventoryManagementChangedPayload,
  ProductMasterActiveVersionChangedPayload,
  ProductMasterDeletedPayload,
  ProductVariantCreatedPayload,
  ProductVariantDeletedPayload,
  ProductVariantUpdatedPayload,
} from '@packages/event-contracts/streams/product.stream';
import { DomainEvent } from '@packages/event-contracts/types';
import { ProductDimensionsService } from '../dimensions/product-dimensions.service';

@Controller()
@UseFilters(EventsExceptionFilter)
@UseInterceptors(EventTypeGuard)
export class ProductEventsConsumer {
  private readonly logger = new Logger(ProductEventsConsumer.name);

  constructor(private readonly productDimensionsService: ProductDimensionsService) {}

  @OnEvent('products.events.v1', 'ProductVariantCreated')
  async onVariantCreated(
    @EventEnvelope() envelope: DomainEvent<ProductVariantCreatedPayload>,
    @EventPayload() payload: ProductVariantCreatedPayload,
  ) {
    this.logger.log(`ProductVariantCreated received: ${payload.masterId}/${payload.variantId}`);
    await this.productDimensionsService.recordVariantCreated(payload);
    this.logger.debug(`ProductVariantCreated processed: ${payload.variantId} (${envelope.messageId})`);
  }

  @OnEvent('products.events.v1', 'ProductVariantUpdated')
  async onVariantUpdated(
    @EventEnvelope() envelope: DomainEvent<ProductVariantUpdatedPayload>,
    @EventPayload() payload: ProductVariantUpdatedPayload,
  ) {
    this.logger.log(`ProductVariantUpdated received: ${payload.masterId}/${payload.variantId}`);
    await this.productDimensionsService.recordVariantUpdated(payload);
    this.logger.debug(`ProductVariantUpdated processed: ${payload.variantId} (${envelope.messageId})`);
  }

  @OnEvent('products.events.v1', 'ProductVariantDeleted')
  async onVariantDeleted(
    @EventEnvelope() envelope: DomainEvent<ProductVariantDeletedPayload>,
    @EventPayload() payload: ProductVariantDeletedPayload,
  ) {
    this.logger.log(`ProductVariantDeleted received: ${payload.masterId}/${payload.variantId}`);
    await this.productDimensionsService.recordVariantDeleted(payload);
    this.logger.debug(`ProductVariantDeleted processed: ${payload.variantId} (${envelope.messageId})`);
  }

  @OnEvent('products.events.v1', 'ProductInventoryManagementChanged')
  async onInventoryManagementChanged(
    @EventEnvelope() envelope: DomainEvent<ProductInventoryManagementChangedPayload>,
    @EventPayload() payload: ProductInventoryManagementChangedPayload,
  ) {
    this.logger.log(`ProductInventoryManagementChanged received: ${payload.masterId}`);
    await this.productDimensionsService.recordInventoryManagementChanged(payload);
    this.logger.debug(`ProductInventoryManagementChanged processed: ${payload.masterId} (${envelope.messageId})`);
  }

  @OnEvent('products.events.v1', 'ProductMasterActiveVersionChanged')
  async onMasterActiveVersionChanged(
    @EventEnvelope() envelope: DomainEvent<ProductMasterActiveVersionChangedPayload>,
    @EventPayload() payload: ProductMasterActiveVersionChangedPayload,
  ) {
    this.logger.log(`ProductMasterActiveVersionChanged received: ${payload.masterId}`);
    await this.productDimensionsService.recordMasterActiveVersionChanged(payload);
    this.logger.debug(`ProductMasterActiveVersionChanged processed: ${payload.masterId} (${envelope.messageId})`);
  }

  @OnEvent('products.events.v1', 'ProductMasterDeleted')
  async onMasterDeleted(
    @EventEnvelope() envelope: DomainEvent<ProductMasterDeletedPayload>,
    @EventPayload() payload: ProductMasterDeletedPayload,
  ) {
    this.logger.log(`ProductMasterDeleted received: ${payload.masterId}`);
    await this.productDimensionsService.recordMasterDeleted(payload);
    this.logger.debug(`ProductMasterDeleted processed: ${payload.masterId} (${envelope.messageId})`);
  }
}
