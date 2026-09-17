import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InternalOnly } from '@app/authorization';
import { MAX_REFERENCE_QUERY_IDS, ProductFileReferencesService } from './product-file-references.service';

/**
 * 서비스 간 호출 전용. ai 앱의 고아 파일 수거 크론이 "이 fileId 들이 상품에 붙어
 * 있냐" 를 묻는다. 사람 JWT 가 없는 호출자라 공유 키로 인증한다.
 */
@ApiExcludeController()
@InternalOnly()
@Controller('internal/product-files')
export class ProductFilesInternalController {
  constructor(private readonly references: ProductFileReferencesService) {}

  @Get('referenced')
  async getReferenced(@Query('fileIds') fileIds?: string): Promise<{ referenced: string[] }> {
    const ids = (fileIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    if (ids.length === 0) throw new BadRequestException('fileIds is required');
    if (ids.length > MAX_REFERENCE_QUERY_IDS) {
      throw new BadRequestException(`fileIds is limited to ${MAX_REFERENCE_QUERY_IDS} per request`);
    }

    return { referenced: await this.references.findReferenced(ids) };
  }
}
