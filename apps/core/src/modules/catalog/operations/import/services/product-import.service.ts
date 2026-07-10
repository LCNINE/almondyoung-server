import { Injectable } from '@nestjs/common';
import { ProductImportParser } from './product-import.parser';
import { ProductImportNormalizer } from './product-import.normalizer';
import { ProductImportValidator } from './product-import.validator';
import { ProductImportSessionReader } from './product-import-session.reader';
import { ProductImportManager } from './product-import.manager';
import { generateTemplateWorkbook } from './product-import.template';
import { ProductRecord } from '../dto/import.types';
import {
  ValidatePreviewDto,
  ValidatePreviewRowDto,
  CommitResultDto,
  SessionSummaryDto,
  SessionDetailDto,
  PublishResultDto,
} from '../dto/import-response.dto';

@Injectable()
export class ProductImportService {
  constructor(
    private readonly parser: ProductImportParser,
    private readonly normalizer: ProductImportNormalizer,
    private readonly validator: ProductImportValidator,
    private readonly reader: ProductImportSessionReader,
    private readonly manager: ProductImportManager,
  ) {}

  private async pipeline(buffer: Buffer): Promise<ProductRecord[]> {
    const parsed = await this.parser.parse(buffer);
    const categories = await this.reader.loadCategoryTree();
    return this.validator.validate(this.normalizer.normalize(parsed, categories));
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

  async commit(buffer: Buffer, fileName: string, userId: string): Promise<CommitResultDto> {
    const records = await this.pipeline(buffer);
    return this.manager.commit({ fileName, userId, records });
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
      })),
    };
  }

  publishSession(sessionId: string): Promise<PublishResultDto> {
    return this.manager.publishSession(sessionId);
  }

  getTemplate(): Promise<Buffer> {
    return generateTemplateWorkbook();
  }

  private variantCount(record: ProductRecord): number {
    if (record.options.length === 0) return 1;
    return record.options.reduce((acc, o) => acc * Math.max(o.values.length, 1), 1);
  }

  private toSummary(session: {
    id: string;
    fileName: string | null;
    totalRows: number;
    createdCount: number;
    failedCount: number;
    status: string;
    createdAt: Date;
  }): SessionSummaryDto {
    return {
      id: session.id,
      fileName: session.fileName,
      totalRows: session.totalRows,
      createdCount: session.createdCount,
      failedCount: session.failedCount,
      status: session.status,
      createdAt: session.createdAt,
    };
  }
}
