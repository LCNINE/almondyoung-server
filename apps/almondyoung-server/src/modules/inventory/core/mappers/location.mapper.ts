import {
  LocationColumnResponseDto,
  LocationRackResponseDto,
  ZoneLocationResponseDto,
  StandardLocationResponseDto,
} from '../dto';
import { LocationColumn, LocationRack, Location } from '../../schema/inventory.schema';

export class LocationMapper {
  static toLocationRackResponseDto(rack: LocationRack & { column: LocationColumn }): LocationRackResponseDto {
    return {
      id: rack.id,
      columnId: rack.columnId,
      column: LocationMapper.toLocationColumnResponseDto(rack.column),
      rackNumber: rack.rackNumber,
      defaultBinStart: rack.defaultBinStart,
      defaultBinEnd: rack.defaultBinEnd,
      autoGenerateBins: rack.autoGenerateBins,
      physicalWidth: rack.physicalWidth,
      physicalHeight: rack.physicalHeight,
      notes: rack.notes,
      isActive: rack.isActive,
      createdAt: rack.createdAt.toISOString(),
      updatedAt: rack.updatedAt.toISOString(),
    };
  }

  static toLocationColumnResponseDto(column: LocationColumn): LocationColumnResponseDto {
    return {
      id: column.id,
      warehouseId: column.warehouseId,
      columnName: column.columnName,
      displayOrder: column.displayOrder,
      isActive: column.isActive,
      createdAt: column.createdAt.toISOString(),
      updatedAt: column.updatedAt.toISOString(),
    };
  }

  static toLocationResponseDto(location: Location): StandardLocationResponseDto | ZoneLocationResponseDto {
    const { locationType, rackId, binIdentifier, ...rest } = location;
    if (locationType === 'standard') {
      return {
        ...rest,
        locationType,
        rackId: rackId as string,
        binIdentifier: binIdentifier as string,
        updatedAt: location.updatedAt.toISOString(),
        createdAt: location.createdAt.toISOString(),
      } as StandardLocationResponseDto;
    } else {
      return {
        ...rest,
        locationType,
        rackId: null,
        binIdentifier: null,
        updatedAt: location.updatedAt.toISOString(),
        createdAt: location.createdAt.toISOString(),
      } as ZoneLocationResponseDto;
    }
  }
}
