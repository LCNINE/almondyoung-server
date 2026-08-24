import { Warehouse } from '../../schema/inventory.schema';
import { WarehouseDto } from '../dto/warehouse.dto';

export class WarehouseMapper {
  static toDto(warehouse: Warehouse): WarehouseDto {
    return {
      id: warehouse.id,
      name: warehouse.name,
      location: warehouse.location,
      type: warehouse.type,
      // ?? 나 || 로 정규화하지 않는다 — false 가 falsy 라 비판매 창고가 판매 창고로 뒤집힌다.
      isSellable: warehouse.isSellable,
      supportedPickingStrategies: warehouse.supportedPickingStrategies ?? [],
      createdAt: warehouse.createdAt.toISOString(),
      updatedAt: warehouse.updatedAt.toISOString(),
    };
  }
}
