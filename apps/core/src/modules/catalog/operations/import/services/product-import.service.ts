import { Injectable } from '@nestjs/common';
import { ProductImportParser } from './product-import.parser';
import { ProductImportNormalizer } from './product-import.normalizer';
import { ProductImportValidator } from './product-import.validator';
import { ProductImportSessionReader, SessionRow } from './product-import-session.reader';
import { ProductImportManager } from './product-import.manager';
import { ProductImportVariantCodeChecker } from './product-import-variant-code.checker';
import { ProductImportProgressBuilder } from './product-import-progress.builder';
import { generateTemplateWorkbook } from './product-import.template';
import { ProductRecord, formatKstMinutes } from '../dto/import.types';
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
        categoryCount: r.categoryIds.length,
        salesPeriod: this.salesPeriod(r),
        variantCount: this.variantCount(r),
        imageCount: r.imageRefs?.length ?? 0,
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
    const { session, itemCounts, imageCounts } = await this.reader.getProgressCounts(sessionId);
    return this.progressBuilder.build(session, itemCounts, imageCounts);
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

  /**
   * 판매기간을 KST 로 사람이 읽을 수 있게 만든다.
   *
   * 프리뷰에 넣는 이유가 있다 — sales_start_date/sales_end_date 는 **임포트가 유일한 쓰기
   * 경로**이고 admin 화면에 편집·해제 수단이 없다(레포 전체에 다른 write 경로가 없다).
   * 잘못 넣으면 상품은 정상 게시되고 스토어프론트에서만 SALES_ENDED 로 조용히 품절되므로,
   * 커밋 전에 확인할 수 있는 자리가 여기뿐이다.
   */
  private salesPeriod(record: ProductRecord): string | null {
    if (!record.salesStartDate && !record.salesEndDate) return null;
    // 한쪽만 있을 때 빈 문자열을 그대로 두면 "2026-08-01 00:00 ~ " 처럼 잘린 표시가 되어
    // MD 가 "제한 없음"으로 오독할 수 있다 — 없는 쪽을 명시적으로 적는다.
    const start = record.salesStartDate ? formatKstMinutes(record.salesStartDate) : '시작일 없음';
    const end = record.salesEndDate ? formatKstMinutes(record.salesEndDate) : '종료일 없음';
    return `${start} ~ ${end}`;
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
      imageStatus: session.imageStatus,
      imageError: session.imageError,
    };
  }
}
