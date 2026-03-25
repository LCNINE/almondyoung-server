import { Controller, Logger, UseFilters, UseInterceptors } from '@nestjs/common';
import { OnEvent, EventPayload, EventEnvelope, EventsExceptionFilter } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import {
  ProductVariantCreatedPayload,
  ProductVariantDeletedPayload,
  ProductInventoryManagementChangedPayload,
} from '@packages/event-contracts';
import { ProductMatchingService } from '../services/product-matching.service';

@Controller()
@UseFilters(EventsExceptionFilter)
@UseInterceptors(EventTypeGuard)
export class ProductEventConsumer {
  private readonly logger = new Logger(ProductEventConsumer.name);

  constructor(private readonly productMatchingService: ProductMatchingService) {}

  @OnEvent('products.events.v1', 'ProductVariantCreated')
  async onProductVariantCreated(@EventPayload() payload: ProductVariantCreatedPayload, @EventEnvelope() envelope: any) {
    this.logger.log(
      `[Event] Received ProductVariantCreated: ${payload.variantId} (correlationId: ${envelope.correlationId})`,
    );

    try {
      if (!payload.inventoryManagement) {
        const result = await this.productMatchingService.handleAutomaticMatchingRequest({
          masterId: payload.masterId,
          name: payload.productName,
          variants: [
            {
              id: payload.variantId,
              name: payload.variantName ?? '',
              inventoryManagement: false,
              components: [],
            },
          ],
        });

        this.logger.log(
          `[Event] Created auto-ignored matching for ${payload.variantId}: ${result.created} created, ${result.skipped} skipped`,
        );
      } else {
        const result = await this.productMatchingService.handleManualMatchingRequest({
          masterId: payload.masterId,
          name: payload.productName,
          variants: [
            {
              id: payload.variantId,
              name: payload.variantName ?? '',
              inventoryManagement: true,
              preStockSellable: payload.preStockSellable ?? false,
              alwaysSellableZeroStock: payload.alwaysSellableZeroStock ?? false,
              components: [],
            },
          ],
        });

        if (result.skipped > 0) {
          this.logger.log(`[Event] Matching already exists for ${payload.variantId} (likely created by orchestrator)`);
        } else {
          this.logger.log(`[Event] Created ${result.created} matching-pending record(s)`);
        }
      }
    } catch (error) {
      this.logger.error(`[Event] Failed to handle ProductVariantCreated: ${payload.variantId}`, error.stack);
      // Re-throw to send to DLQ
      throw error;
    }
  }

  @OnEvent('products.events.v1', 'ProductInventoryManagementChanged')
  async onInventoryManagementChanged(
    @EventPayload() payload: ProductInventoryManagementChangedPayload,
    @EventEnvelope() envelope: any,
  ) {
    this.logger.log(
      `[Event] Received ProductInventoryManagementChanged: ${payload.masterId} (correlationId: ${envelope.correlationId})`,
    );

    try {
      const variants = payload.affectedVariants.map((v) => ({
        id: v.variantId,
        name: v.variantName ?? '',
        inventoryManagement: payload.inventoryManagement,
        components: [],
      }));

      if (payload.inventoryManagement) {
        const result = await this.productMatchingService.handleManualMatchingRequest({
          masterId: payload.masterId,
          name: payload.productName,
          variants,
        });

        this.logger.log(
          `[Event] Updated matching for ${variants.length} variant(s): ${result.created} created, ${result.skipped} skipped`,
        );
      } else {
        const result = await this.productMatchingService.handleAutomaticMatchingRequest({
          masterId: payload.masterId,
          name: payload.productName,
          variants,
        });

        this.logger.log(
          `[Event] Updated matching for ${variants.length} variant(s): ${result.created} created, ${result.skipped} skipped`,
        );
      }
    } catch (error) {
      this.logger.error(`[Event] Failed to handle ProductInventoryManagementChanged: ${payload.masterId}`, error.stack);
      throw error;
    }
  }

  @OnEvent('products.events.v1', 'ProductVariantDeleted')
  async onProductVariantDeleted(@EventPayload() payload: ProductVariantDeletedPayload, @EventEnvelope() envelope: any) {
    this.logger.log(
      `[Event] Received ProductVariantDeleted: ${payload.variantId} (correlationId: ${envelope.correlationId})`,
    );

    try {
      // TODO: Implement matching deletion or status change
      this.logger.warn(`[Event] ProductVariantDeleted handler not implemented yet for ${payload.variantId}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to handle ProductVariantDeleted: ${payload.variantId}`, error.stack);
      throw error;
    }
  }
}
