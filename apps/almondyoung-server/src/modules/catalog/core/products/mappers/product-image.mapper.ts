import { ProductImageEntity } from 'apps/pim/src/schema.types';
import { DateMapper } from '../../../common/mappers';
import { ProductImageDto } from '../dto/products/product-image.dto';

export class ProductImageMapper {
  static toDto(image: ProductImageEntity): ProductImageDto {
    return {
      id: image.id,
      versionId: image.versionId,
      fileId: image.fileId,
      isPrimary: image.isPrimary,
      sortOrder: image.sortOrder,
      createdAt: DateMapper.toNotNullString(image.createdAt),
    };
  }
}
