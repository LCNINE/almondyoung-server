import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventEnvelope, EventPayload, OnEvent } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import {
  ProductMasterActiveVersionChangedPayload,
  ProductMasterDeletedPayload,
  ProductSnapshot,
} from '@packages/event-contracts/streams/product.stream';
import { DomainEvent } from '@packages/event-contracts/types';
import { ProductIndexService } from './product-index.service';
import { SearchProductDocument } from './types/product-document.type';

@Controller()
@UseInterceptors(EventTypeGuard)
export class ProductEventsConsumer {
  private readonly logger = new Logger(ProductEventsConsumer.name);

  constructor(private readonly productIndexService: ProductIndexService) {}

  @OnEvent('products.events.v1', 'ProductMasterActiveVersionChanged')
  async onProductMasterActiveVersionChanged(
    @EventEnvelope()
    envelope: DomainEvent<ProductMasterActiveVersionChangedPayload>,
    @EventPayload() payload: ProductMasterActiveVersionChangedPayload,
  ): Promise<void> {
    this.logger.log(
      `ProductMasterActiveVersionChanged received: ${payload.masterId} (${payload.changeReason})`,
    );

    if (!payload.versionId || payload.changeReason === 'unpublished') {
      await this.productIndexService.deleteProduct(payload.masterId);
      this.logger.debug(
        `Product removed from index: ${payload.masterId} (${envelope.messageId})`,
      );
      return;
    }

    if (!payload.snapshot) {
      throw new Error(
        `Snapshot is required for active version indexing (${payload.masterId})`,
      );
    }

    const document = this.buildDocument(payload);
    await this.productIndexService.upsertProduct(payload.masterId, document);

    this.logger.debug(
      `Product indexed: ${payload.masterId}/${payload.versionId} (${envelope.messageId})`,
    );
  }

  @OnEvent('products.events.v1', 'ProductMasterDeleted')
  async onProductMasterDeleted(
    @EventEnvelope() envelope: DomainEvent<ProductMasterDeletedPayload>,
    @EventPayload() payload: ProductMasterDeletedPayload,
  ): Promise<void> {
    this.logger.log(`ProductMasterDeleted received: ${payload.masterId}`);
    await this.productIndexService.deleteProduct(payload.masterId);
    this.logger.debug(
      `Product removed from index: ${payload.masterId} (${envelope.messageId})`,
    );
  }

  private buildDocument(
    payload: ProductMasterActiveVersionChangedPayload,
  ): SearchProductDocument {
    const snapshot = payload.snapshot as ProductSnapshot;
    const categoryIds =
      payload.categoryIds ??
      snapshot.categories?.map((category) => category.id) ??
      [];
    const categoryNames = snapshot.categories?.map((category) => category.name) ?? [];
    const basePrices = snapshot.variants
      .map((variant) => variant.basePrice)
      .filter(
        (price): price is number =>
          typeof price === 'number' && Number.isFinite(price),
      );
    const membershipPrices = snapshot.variants
      .map((variant) => variant.membershipPrice)
      .filter(
        (price): price is number =>
          typeof price === 'number' && Number.isFinite(price),
      );

    return {
      master_id: payload.masterId,
      version_id: payload.versionId as string,
      name: snapshot.name,
      name_compact: this.compactText(snapshot.name),
      description: snapshot.description ?? null,
      thumbnail: snapshot.thumbnail ?? null,
      brand: snapshot.brand ?? null,
      category_ids: categoryIds,
      category_names: categoryNames,
      tags: snapshot.tags ?? [],
      min_base_price: basePrices.length > 0 ? Math.min(...basePrices) : null,
      max_base_price: basePrices.length > 0 ? Math.max(...basePrices) : null,
      min_membership_price:
        membershipPrices.length > 0 ? Math.min(...membershipPrices) : null,
      max_membership_price:
        membershipPrices.length > 0 ? Math.max(...membershipPrices) : null,
      status: snapshot.status ?? 'active',
      changed_at: payload.changedAt,
      updated_at: payload.changedAt,
    };
  }

  private compactText(value: string): string {
    return value.replace(/\s+/g, '');
  }
}
