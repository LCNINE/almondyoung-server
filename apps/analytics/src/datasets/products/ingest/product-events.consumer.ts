import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventEnvelope, EventPayload, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { ProductDimensionsService } from '../dimensions/product-dimensions.service';
import { PRODUCT_STREAM } from '@packages/event-contracts/streams/product.stream';
import { EventPayloadOf, EnvelopeOf } from '@packages/event-contracts/types';

@Controller()
@UseInterceptors(EventTypeGuard)
export class ProductEventsConsumer {
  private readonly logger = new Logger(ProductEventsConsumer.name);

  constructor(private readonly productDimensionsService: ProductDimensionsService) {}

  @On(PRODUCT_STREAM, 'ProductVariantCreated')
  async onVariantCreated(
    @EventEnvelope() envelope: EnvelopeOf<typeof PRODUCT_STREAM, 'ProductVariantCreated'>,
    @EventPayload() payload: EventPayloadOf<typeof PRODUCT_STREAM, 'ProductVariantCreated'>,
  ) {
    this.logger.log(`ProductVariantCreated received: ${payload.masterId}/${payload.variantId}`);
    await this.productDimensionsService.recordVariantCreated(payload);
    this.logger.debug(`ProductVariantCreated processed: ${payload.variantId} (${envelope.messageId})`);
  }

  @On(PRODUCT_STREAM, 'ProductVariantUpdated')
  async onVariantUpdated(
    @EventEnvelope() envelope: EnvelopeOf<typeof PRODUCT_STREAM, 'ProductVariantUpdated'>,
    @EventPayload() payload: EventPayloadOf<typeof PRODUCT_STREAM, 'ProductVariantUpdated'>,
  ) {
    this.logger.log(`ProductVariantUpdated received: ${payload.masterId}/${payload.variantId}`);
    await this.productDimensionsService.recordVariantUpdated(payload);
    this.logger.debug(`ProductVariantUpdated processed: ${payload.variantId} (${envelope.messageId})`);
  }

  @On(PRODUCT_STREAM, 'ProductVariantDeleted')
  async onVariantDeleted(
    @EventEnvelope() envelope: EnvelopeOf<typeof PRODUCT_STREAM, 'ProductVariantDeleted'>,
    @EventPayload() payload: EventPayloadOf<typeof PRODUCT_STREAM, 'ProductVariantDeleted'>,
  ) {
    this.logger.log(`ProductVariantDeleted received: ${payload.masterId}/${payload.variantId}`);
    await this.productDimensionsService.recordVariantDeleted(payload);
    this.logger.debug(`ProductVariantDeleted processed: ${payload.variantId} (${envelope.messageId})`);
  }

  @On(PRODUCT_STREAM, 'ProductInventoryManagementChanged')
  async onInventoryManagementChanged(
    @EventEnvelope() envelope: EnvelopeOf<typeof PRODUCT_STREAM, 'ProductInventoryManagementChanged'>,
    @EventPayload() payload: EventPayloadOf<typeof PRODUCT_STREAM, 'ProductInventoryManagementChanged'>,
  ) {
    this.logger.log(`ProductInventoryManagementChanged received: ${payload.masterId}`);
    await this.productDimensionsService.recordInventoryManagementChanged(payload);
    this.logger.debug(`ProductInventoryManagementChanged processed: ${payload.masterId} (${envelope.messageId})`);
  }

  @On(PRODUCT_STREAM, 'ProductMasterActiveVersionChanged')
  async onMasterActiveVersionChanged(
    @EventEnvelope() envelope: EnvelopeOf<typeof PRODUCT_STREAM, 'ProductMasterActiveVersionChanged'>,
    @EventPayload() payload: EventPayloadOf<typeof PRODUCT_STREAM, 'ProductMasterActiveVersionChanged'>,
  ) {
    this.logger.log(`ProductMasterActiveVersionChanged received: ${payload.masterId}`);
    await this.productDimensionsService.recordMasterActiveVersionChanged(payload);
    this.logger.debug(`ProductMasterActiveVersionChanged processed: ${payload.masterId} (${envelope.messageId})`);
  }

  @On(PRODUCT_STREAM, 'ProductMasterDeleted')
  async onMasterDeleted(
    @EventEnvelope() envelope: EnvelopeOf<typeof PRODUCT_STREAM, 'ProductMasterDeleted'>,
    @EventPayload() payload: EventPayloadOf<typeof PRODUCT_STREAM, 'ProductMasterDeleted'>,
  ) {
    this.logger.log(`ProductMasterDeleted received: ${payload.masterId}`);
    await this.productDimensionsService.recordMasterDeleted(payload);
    this.logger.debug(`ProductMasterDeleted processed: ${payload.masterId} (${envelope.messageId})`);
  }
}
