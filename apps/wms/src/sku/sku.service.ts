import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables } from '../../database/schemas/wms-schema';
import { TypedDatabase } from '@app/db';
import { and, eq, like, or, sql, SQL } from 'drizzle-orm';
import { CreateSkuDto } from './dto/create-sku.dto';
import { UpdateSkuDto } from './dto/update-sku.dto';

@Injectable()
export class SkuService {
  private readonly logger = new Logger(SkuService.name);

  constructor(
    @InjectTypedDb<typeof wmsTables>() private readonly db: TypedDatabase<typeof wmsTables>,
  ) { }

  private _generateSkuCode(): string {
    const prefix = 'P';
    const numericPart = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const alphaPart = Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
    return `${prefix}${numericPart}${alphaPart}`;
  }

  async _createSkuInternal(data: Omit<CreateSkuDto, 'id' | 'code' | 'defaultBarcode'>) {
    const preStockSellable = data.inventoryManagement === true;
    const skuCode = this._generateSkuCode();

    // todo : 자동매칭 시 name 자동생성(pim의 상품 이름 + 옵션 이름) => 수정할 수 있는 것도 추가
    // todo : 수동매칭 시 name 수동입력

    const [newSku] = await this.db.insert(wmsTables.skus).values({
      name: data.name,
      code: skuCode,
      deliveryProfileId: data.deliveryProfileId,
      inventoryManagement: data.inventoryManagement,
      preStockSellable: preStockSellable,
      sale1m: data.sale1m,
      sale3m: data.sale3m,
    }).returning();

    if (!newSku) {
      this.logger.error(`Failed to create SKU internally: ${data.name}`);
      throw new Error('Failed to create SKU internally');
    }

    // SKU 생성 후, 기본 바코드를 자동 생성
    const generatedBarcode = await this.generateAndSetDefaultBarcode(newSku.id, newSku.name);
    newSku.defaultBarcode = generatedBarcode;

    this.logger.log(`SKU created internally: ${newSku.id} (Name: ${newSku.name})`);
    return newSku;
  }

  private async generateAndSetDefaultBarcode(skuId: string, skuName: string): Promise<string> {
    // 실제 바코드 생성 규칙에 따라 바코드 생성 (예: SKU ID + 타임스탬프, SKU 이름 기반 해싱 등)
    // 'SKU_BARCODE_' + SKU ID 앞부분 + 타임스탬프를 사용
    const generatedBarcode = `SKU_B_${skuId.substring(0, 8).toUpperCase()}_${Date.now()}`;

    // skuBarcodes 테이블에 기본 바코드 삽입
    const [newSkuBarcode] = await this.db.insert(wmsTables.skuBarcodes).values({
      skuId: skuId,
      barcode: generatedBarcode,
      barcodeType: 'standard', // 기본 바코드 타입
    }).returning();

    if (!newSkuBarcode) {
      this.logger.error(`Failed to create default barcode for SKU ${skuId}.`);
      throw new Error('Failed to create default barcode for SKU.');
    }

    // skus 테이블의 defaultBarcode 필드 업데이트
    await this.db.update(wmsTables.skus)
      .set({ defaultBarcode: generatedBarcode, updatedAt: new Date() })
      .where(eq(wmsTables.skus.id, skuId));

    this.logger.log(`Default barcode ${generatedBarcode} set for SKU ${skuId}.`);
    return generatedBarcode;
  }

  async _updateSkuInternal(skuId: string, data: Partial<Omit<UpdateSkuDto, 'code' | 'defaultBarcode'>>) {
    // preStockSellable은 _updatePreStockSellableInternal을 통해 변경되므로 여기서는 제외
    const updateData: Partial<typeof wmsTables.skus.$inferInsert> = {
      name: data.name,
      deliveryProfileId: data.deliveryProfileId,
      inventoryManagement: data.inventoryManagement,
      sale1m: data.sale1m,
      sale3m: data.sale3m,
      updatedAt: new Date(),
    };

    const [updatedSku] = await this.db.update(wmsTables.skus)
      .set(updateData)
      .where(eq(wmsTables.skus.id, skuId))
      .returning();

    if (!updatedSku) {
      this.logger.error(`SKU not found for internal update: ${skuId}`);
      throw new NotFoundException(`SKU with ID ${skuId} not found for internal update`);
    }
    this.logger.log(`SKU updated internally: ${updatedSku.id}`);
    return updatedSku;
  }

  async _updatePreStockSellableInternal(skuId: string, value: boolean) {
    const [updatedSku] = await this.db.update(wmsTables.skus)
      .set({
        preStockSellable: value,
        updatedAt: new Date(),
      })
      .where(eq(wmsTables.skus.id, skuId))
      .returning();

    if (!updatedSku) {
      throw new NotFoundException(`SKU with ID ${skuId} not found to update preStockSellable.`);
    }
    this.logger.log(`SKU ${skuId} preStockSellable updated to ${value}.`);
    return updatedSku;
  }

  async findSkuById(skuId: string) {
    return this.db.query.skus.findFirst({
      where: eq(wmsTables.skus.id, skuId)
    });
  }

  async searchSkus(query: { id?: string; code?: string; barcode?: string; name?: string; supplierName?: string }) {
    // 기본 쿼리 구성
    const baseQuery = this.db.select({
      sku: wmsTables.skus,
      barcode: wmsTables.skuBarcodes.barcode,
      supplierName: wmsTables.suppliers.name,
    })
      .from(wmsTables.skus)
      .leftJoin(wmsTables.skuBarcodes, eq(wmsTables.skus.id, wmsTables.skuBarcodes.skuId))
      .leftJoin(wmsTables.skuSuppliers, eq(wmsTables.skus.id, wmsTables.skuSuppliers.skuId))
      .leftJoin(wmsTables.suppliers, eq(wmsTables.skuSuppliers.supplierId, wmsTables.suppliers.id));

    // 조건들을 배열로 수집
    const conditions: SQL[] = [];

    // SKU ID 검색 (id) - 정확히 일치
    if (query.id) {
      conditions.push(eq(wmsTables.skus.id, query.id));
    }

    // SKU 코드 검색 (code) - 정확히 일치
    if (query.code) {
      conditions.push(eq(wmsTables.skus.code, query.code));
    }

    // SKU 이름 검색 (name) - 부분 일치 (ILIKE)
    if (query.name) {
      conditions.push(sql`${wmsTables.skus.name} ILIKE ${'%' + query.name + '%'}`);
    }

    // SKU 바코드 검색 (defaultBarcode 또는 skuBarcodes.barcode) - 정확히 일치
    if (query.barcode) {
      const barcodeCondition = or(
        eq(wmsTables.skus.defaultBarcode, query.barcode),
        eq(wmsTables.skuBarcodes.barcode, query.barcode),
      );
      if (barcodeCondition) {
        conditions.push(barcodeCondition);
      }
    }

    // 공급사 이름 검색 (supplierName) - 부분 일치 (ILIKE)
    if (query.supplierName) {
      conditions.push(sql`${wmsTables.suppliers.name} ILIKE ${'%' + query.supplierName + '%'}`);
    }

    // 조건이 있으면 where 절 추가
    const finalQuery = conditions.length > 0
      ? baseQuery.where(and(...conditions))
      : baseQuery;

    const results = await finalQuery;

    // 중복 제거 및 결과 집계
    const aggregatedSkus = results.reduce((acc, row) => {
      const sku = row.sku;
      if (!acc[sku.id]) {
        acc[sku.id] = {
          ...sku,
          barcodes: [], // 모든 관련 바코드 (default 포함)
          suppliers: [], // 모든 관련 공급사 이름
        };
      }
      if (row.barcode && !acc[sku.id].barcodes.includes(row.barcode)) {
        acc[sku.id].barcodes.push(row.barcode);
      }
      if (row.supplierName && !acc[sku.id].suppliers.includes(row.supplierName)) {
        acc[sku.id].suppliers.push(row.supplierName);
      }
      return acc;
    }, {});

    return Object.values(aggregatedSkus);
  }
}