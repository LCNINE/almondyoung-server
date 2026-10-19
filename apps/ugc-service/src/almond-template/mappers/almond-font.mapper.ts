import { type AlmondFontResponseDto } from '../dto/almond-font.dto';
import { almondFontFamily } from '../print/almond-print-fonts';
import { type AlmondFontEntity } from '../types/almond-font.types';

export class AlmondFontMapper {
  static toResponse(row: AlmondFontEntity): AlmondFontResponseDto {
    return {
      id: row.id,
      name: row.name,
      fileId: row.fileId,
      family: almondFontFamily(row.fileId),
      format: row.format,
    };
  }
}
