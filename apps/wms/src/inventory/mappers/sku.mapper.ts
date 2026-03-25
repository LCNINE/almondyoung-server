import { SkuBarcode } from 'apps/wms/database/schemas/wms-schema';
import { BarcodeDto } from '../dto/sku/sku-response.dto';

export class SkuBarcodeMapper {
  static toDto(barcode: SkuBarcode): BarcodeDto {
    return {
      id: barcode.id,
      barcode: barcode.barcode,
      isPrimary: barcode.isPrimary,
      packingUnit: barcode.packingUnit,
    };
  }
}
