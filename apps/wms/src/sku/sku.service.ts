import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../database/schemas/wms-schema';
import { TypedDatabase } from '@app/db';
import { and, eq, like } from 'drizzle-orm';
import { CreateSkuDto } from './dto/create-sku.dto';
import { UpdateSkuDto } from './dto/update-sku.dto';

@Injectable()
export class SkuService {
  private readonly logger = new Logger(SkuService.name);

  constructor(
    @InjectTypedDb<typeof wmsTables>() private readonly db: TypedDatabase<typeof wmsTables>,
  ) { }

  async _createSkuInternal(data: CreateSkuDto) {
    const [newSku] = await this.db.insert(wmsTables.skus).values({
      id: data.id,
      name: data.name,
      defaultBarcode: data.defaultBarcode,
      deliveryProfileId: data.deliveryProfileId,
      inventoryManagement: data.inventoryManagement,
      sale1m: data.sale1m,
      sale3m: data.sale3m,
    }).returning();

    if (!newSku) {
      this.logger.error(`Failed to create SKU internally: ${data.name}`);
      throw new Error('Failed to create SKU internally');
    }
    this.logger.log(`SKU created internally: ${newSku.id}`);
    return newSku;
  }

  async _updateSkuInternal(skuId: string, data: Partial<UpdateSkuDto>) {
    const [updatedSku] = await this.db.update(wmsTables.skus)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(wmsTables.skus.id, skuId))
      .returning();

    if (!updatedSku) {
      this.logger.error(`SKU not found for internal update: ${skuId}`);
      throw new NotFoundException(`SKU with ID ${skuId} not found for internal update`);
    }
    this.logger.log(`SKU updated internally: ${updatedSku.id}`);
    return updatedSku;
  }

  async findSkuById(skuId: string) {
    return this.db.query.skus.findFirst({
      where: eq(wmsTables.skus.id, skuId)
    });
  }

  async searchSkus(name?: string, barcode?: string) {
    if (!name && !barcode) {
      throw new Error('Either name or barcode must be provided for SKU search.');
    }

    const skus = await this.db.query.skus.findMany({
      where: (skus, { or, and }) =>
        and(
          name ? like(skus.name, `%${name}%`) : undefined,
          barcode ? like(skus.defaultBarcode, `%${barcode}%`) : undefined,
        ),
    });

    return skus;
  }
}