import {
  AdminAlmondDesignResponseDto,
  AlmondDesignCreatedResponseDto,
  AlmondDesignResponseDto,
} from '../dto/almond-design.dto';
import { type AlmondDesignView } from '../types/almond-design.types';

export class AlmondDesignMapper {
  static toCreated(row: Pick<AlmondDesignView, 'id' | 'createdAt'>): AlmondDesignCreatedResponseDto {
    return { id: row.id, createdAt: row.createdAt.toISOString() };
  }

  static toResponse(row: AlmondDesignView): AlmondDesignResponseDto {
    return { id: row.id, design: row.design, templateId: row.templateId, createdAt: row.createdAt.toISOString() };
  }

  static toAdminResponse(row: AlmondDesignView): AdminAlmondDesignResponseDto {
    return { ...this.toResponse(row), userId: row.userId };
  }
}
