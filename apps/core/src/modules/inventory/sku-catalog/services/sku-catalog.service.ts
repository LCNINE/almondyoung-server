import { Injectable } from '@nestjs/common';
import { DbTx } from '../../schema/inventory.schema';
import { CreateSkuDto } from '../dto/create-sku.dto';
import { UpdateSkuDto } from '../dto/update-sku.dto';
import { AddBarcodeDto } from '../dto/add-barcode.dto';
import { AdvancedInventoryFiltersDto } from '../dto/advanced-filters.dto';
import { SkuCatalogReader } from './sku-catalog.reader';
import { SkuCatalogManager } from './sku-catalog.manager';

@Injectable()
export class SkuCatalogService {
  constructor(
    private readonly reader: SkuCatalogReader,
    private readonly manager: SkuCatalogManager,
  ) {}

  // Reader

  findById(skuId: string, tx?: DbTx) {
    return this.reader.findById(skuId, tx);
  }

  getById(skuId: string, tx?: DbTx, warehouseId?: string) {
    return this.reader.getById(skuId, tx, warehouseId);
  }

  search(query: Parameters<SkuCatalogReader['search']>[0], tx?: DbTx) {
    return this.reader.search(query, tx);
  }

  searchAdvanced(filters: AdvancedInventoryFiltersDto, tx?: DbTx) {
    return this.reader.searchAdvanced(filters, tx);
  }

  getDeleted(filters: Parameters<SkuCatalogReader['getDeleted']>[0], tx?: DbTx) {
    return this.reader.getDeleted(filters, tx);
  }

  // Manager

  create(dto: CreateSkuDto, tx?: DbTx) {
    return this.manager.create(dto, tx);
  }

  update(skuId: string, dto: UpdateSkuDto, tx?: DbTx) {
    return this.manager.update(skuId, dto, tx);
  }

  delete(skuId: string, tx?: DbTx) {
    return this.manager.delete(skuId, tx);
  }

  restore(skuId: string, tx?: DbTx) {
    return this.manager.restore(skuId, tx);
  }

  addBarcode(skuId: string, dto: AddBarcodeDto, tx?: DbTx) {
    return this.manager.addBarcode(skuId, dto, tx);
  }

  removeBarcode(skuId: string, barcodeId: string, tx?: DbTx) {
    return this.manager.removeBarcode(skuId, barcodeId, tx);
  }
}
