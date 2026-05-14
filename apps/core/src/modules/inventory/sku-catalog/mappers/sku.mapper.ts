import { SkuBarcode } from '../../schema/inventory.schema';
import { BarcodeDto } from '../dto/sku-response.dto';

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
