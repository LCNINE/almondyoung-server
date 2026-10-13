import {
  type AlmondSavedDesignDetailResponseDto,
  type AlmondSavedDesignSummaryResponseDto,
} from '../dto/almond-saved-design.dto';
import { type AlmondSavedDesignEntity, type AlmondSavedDesignSummary } from '../types/almond-saved-design.types';

export class AlmondSavedDesignMapper {
  static toSummary(row: AlmondSavedDesignSummary): AlmondSavedDesignSummaryResponseDto {
    return {
      id: row.id,
      title: row.title,
      productId: row.productId,
      size: `${row.widthMm}x${row.heightMm}`,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  static toDetail(row: AlmondSavedDesignEntity): AlmondSavedDesignDetailResponseDto {
    return { ...this.toSummary(row), design: row.design };
  }
}
