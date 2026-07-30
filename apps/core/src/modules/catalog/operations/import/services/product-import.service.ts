import { Injectable } from '@nestjs/common';
import { ProductImportParser } from './product-import.parser';
import { ProductImportNormalizer } from './product-import.normalizer';
import { ProductImportValidator } from './product-import.validator';
import { ProductImportSessionReader, SessionRow } from './product-import-session.reader';
import { ProductImportManager } from './product-import.manager';
import { ProductImportVariantCodeChecker } from './product-import-variant-code.checker';
import { ProductImportProgressBuilder } from './product-import-progress.builder';
import { generateTemplateWorkbook } from './product-import.template';
import { ProductRecord } from '../dto/import.types';
import {
  ValidatePreviewDto,
  ValidatePreviewRowDto,
  CommitAcceptedDto,
  SessionSummaryDto,
  SessionDetailDto,
  PublishAcceptedDto,
  CancelAcceptedDto,
} from '../dto/import-response.dto';
import { ImportProgressDto } from '../dto/import-progress.dto';

@Injectable()
export class ProductImportService {
  constructor(
    private readonly parser: ProductImportParser,
    private readonly normalizer: ProductImportNormalizer,
    private readonly validator: ProductImportValidator,
    private readonly reader: ProductImportSessionReader,
    private readonly manager: ProductImportManager,
    private readonly variantCodeChecker: ProductImportVariantCodeChecker,
    private readonly progressBuilder: ProductImportProgressBuilder,
  ) {}

  private async pipeline(buffer: Buffer): Promise<ProductRecord[]> {
    const parsed = await this.parser.parse(buffer);
    const categories = await this.reader.loadCategoryTree();
    const records = this.validator.validate(this.normalizer.normalize(parsed, categories));
    // variantCode 충돌은 레코드 하나만 봐서는 알 수 없다(파일 전체 + DB 전역).
    // validate 뒤에 두어 프리뷰와 커밋이 같은 판정을 보게 한다.
    await this.variantCodeChecker.check(records);
    return records;
  }

  async validate(buffer: Buffer): Promise<ValidatePreviewDto> {
    const records = await this.pipeline(buffer);
    const rows: ValidatePreviewRowDto[] = records.map((r) => ({
      rowNumber: r.rowNumber,
      productKey: r.productKey,
      status: r.errors.length === 0 ? 'valid' : 'invalid',
      errors: r.errors.map((e) => `[${e.sheet} ${e.rowNumber}행] ${e.message}`),
      resolved: {
        name: typeof r.version.name === 'string' ? r.version.name : (r.raw.name ?? ''),
        categoryNames: r.categoryNames,
        variantCount: this.variantCount(r),
      },
    }));
    const validCount = rows.filter((r) => r.status === 'valid').length;
    return { totalRows: records.length, validCount, invalidCount: records.length - validCount, rows };
  }

  async commit(buffer: Buffer, fileName: string, userId: string): Promise<CommitAcceptedDto> {
    const records = await this.pipeline(buffer);
    return this.manager.acceptCommit({ fileName, userId, records });
  }

  async getSessions(
    page: number,
    limit: number,
  ): Promise<{ data: SessionSummaryDto[]; total: number; page: number; limit: number }> {
    const { data, total } = await this.reader.getSessions(page, limit);
    return { data: data.map((s) => this.toSummary(s)), total, page, limit };
  }

  async getSession(sessionId: string): Promise<SessionDetailDto> {
    const { session, items } = await this.reader.getSession(sessionId);
    return {
      ...this.toSummary(session),
      items: items.map((i) => ({
        rowNumber: i.rowNumber,
        productKey: i.productKey ?? '',
        status: i.status,
        masterId: i.masterId ?? undefined,
        errorMessage: i.errorMessage ?? undefined,
        publishStatus: i.publishStatus,
        publishError: i.publishError ?? undefined,
      })),
    };
  }

  /**
   * 단계별 집계만 돌려준다 — 행 목록이 없어 응답 크기가 세션 크기와 무관하다.
   * admin-web 의 폴링 대상은 getSession 이 아니라 이쪽이다.
   */
  async getProgress(sessionId: string): Promise<ImportProgressDto> {
    const { session, itemCounts } = await this.reader.getProgressCounts(sessionId);
    return this.progressBuilder.build(session, itemCounts);
  }

  publishSession(sessionId: string): Promise<PublishAcceptedDto> {
    return this.manager.queuePublish(sessionId);
  }

  cancelSession(sessionId: string): Promise<CancelAcceptedDto> {
    return this.manager.cancelSession(sessionId);
  }

  getTemplate(): Promise<Buffer> {
    return generateTemplateWorkbook();
  }

  private variantCount(record: ProductRecord): number {
    if (record.options.length === 0) return 1;
    return record.options.reduce((acc, o) => acc * Math.max(o.values.length, 1), 1);
  }

  private toSummary(session: SessionRow): SessionSummaryDto {
    return {
      id: session.id,
      fileName: session.fileName,
      totalRows: session.totalRows,
      createdCount: session.createdCount,
      failedCount: session.failedCount,
      status: session.status,
      createdAt: session.createdAt,
      commitStatus: session.commitStatus,
      publishStatus: session.publishStatus,
      publishedCount: session.publishedCount,
      publishFailedCount: session.publishFailedCount,
      commitError: session.commitError,
      publishError: session.publishError,
      invalidCount: session.invalidCount,
      cancelRequestedAt: session.cancelRequestedAt,
    };
  }
}
