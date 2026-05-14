import { Warehouse } from '../../schema/inventory.schema';
import { WarehouseDto } from '../dto/warehouse.dto';

export class WarehouseMapper {
  static toDto(warehouse: Warehouse): WarehouseDto {
    return {
      id: warehouse.id,
      name: warehouse.name,
      location: warehouse.location,
      type: warehouse.type,
      createdAt: warehouse.createdAt.toISOString(),
      updatedAt: warehouse.updatedAt.toISOString(),
    };
  }
}
