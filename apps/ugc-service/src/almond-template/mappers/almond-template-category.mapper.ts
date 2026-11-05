import { type AlmondTemplateCategoryResponseDto } from '../dto/almond-template-category.dto';
import { type AlmondTemplateCategoryEntity } from '../types/almond-template-category.types';

export class AlmondTemplateCategoryMapper {
  static toResponse(row: AlmondTemplateCategoryEntity): AlmondTemplateCategoryResponseDto {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      imageFileId: row.imageFileId,
      kind: row.kind,
      sortOrder: row.sortOrder,
      isVisible: row.isVisible,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
