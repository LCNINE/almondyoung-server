import { Injectable, Logger } from '@nestjs/common';
import { PassThrough, Readable } from 'node:stream';
import * as ExcelJS from 'exceljs';
import { BadRequestError } from '@app/shared';
import { ProductMastersService } from '../../core/products/services/product-masters.service';
import { ProductMasterMapper } from '../../core/products/mappers';
import { SuppliersService } from '../../../inventory/suppliers/services/suppliers.service';
import { ExportRow, resolveColumns } from './product-export.columns';

/** 한 번에 내보낼 수 있는 상한. 넘으면 필터를 좁히라고 되돌린다. */
const MAX_ROWS = 50_000;

/** 조회 한 묶음. 한 번에 다 읽으면 버전 행(상세 HTML 포함)이 한꺼번에 올라와 core 가 OOM 으로 죽었다(2026-11-02). */
const BATCH_SIZE = 1_000;

type MasterListItem = Awaited<ReturnType<ProductMastersService['getMasters']>>['data'][number];

export type ProductExportRequest = {
  /** 내보낼 열 key 순서. 비우면 기본 양식. */
  columns?: string[];
  /** 선택항목 다운로드 — 이게 있으면 filters 는 무시된다. */
  ids?: string[];
  /** 검색결과 전체 다운로드 — 목록 화면과 같은 필터. */
  filters?: Parameters<ProductMastersService['getMasters']>[0];
};

@Injectable()
export class ProductExportService {
  private readonly logger = new Logger(ProductExportService.name);

  constructor(
    private readonly productMastersService: ProductMastersService,
    private readonly suppliersService: SuppliersService,
  ) {}

  /**
   * 상품 목록을 xlsx 스트림으로 내보낸다.
   *
   * 행은 BATCH_SIZE 묶음으로 조회하고, 시트 쓰기는 WorkbookWriter 로 스트리밍한다 —
   * 비스트리밍 Workbook 은 셀 객체를 전부 메모리에 들고 있어 10,021행 × 19열이면 그쪽이 먼저 터진다.
   *
   * 응답 전에는 첫 묶음만 읽는다. 상한 초과(400)는 헤더를 보내기 전에만 알릴 수 있어서다.
   * 나머지 묶음까지 다 읽고 응답하면 1만 건(라이브 약 40초)이 admin-web 프록시의 헤더 대기
   * 30초를 넘겨 504 가 났다(2026-11-03).
   *
   * 묶음은 offset 페이징이라 내보내는 도중 상품이 추가·삭제되면 행이 겹치거나 빠질 수 있다.
   * 엑셀 내보내기에선 받아들인다.
   */
  async export(request: ProductExportRequest): Promise<{ stream: Readable; rowCount: number }> {
    const columns = resolveColumns(request.columns);
    const filters = this.toFilters(request);

    const first = await this.loadBatch(filters, 1);
    if (first.total > MAX_ROWS) {
      throw new BadRequestError(
        `내보낼 상품이 ${first.total.toLocaleString()}건입니다. ` +
          `한 번에 ${MAX_ROWS.toLocaleString()}건까지만 가능하니 필터를 좁혀주세요.`,
      );
    }
    const supplierNames = await this.loadSupplierNames();

    const stream = new PassThrough();
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true });
    const sheet = workbook.addWorksheet('상품목록');

    sheet.columns = columns.map((c) => ({ header: c.label, key: c.key, width: c.width }));
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).commit();

    // 쓰기는 응답이 흐르기 시작한 뒤에도 계속된다 — await 하지 않고 백그라운드로 돌린다.
    // (await 하면 PassThrough 버퍼가 차서 소비자가 없는 동안 교착된다.)
    void (async () => {
      try {
        let batch = first.data;
        for (let page = 1; ; ) {
          for (const row of this.toRows(batch, supplierNames)) {
            sheet.addRow(columns.map((c) => c.value(row))).commit();
          }
          if (batch.length < BATCH_SIZE) break;
          // 받는 쪽이 끊었으면(프록시 타임아웃·탭 닫기) 남은 묶음을 읽지 않는다.
          if (stream.destroyed) return;
          batch = (await this.loadBatch(filters, ++page)).data;
          if (stream.destroyed) return;
        }
        sheet.commit();
        await workbook.commit();
      } catch (error) {
        this.logger.error(`엑셀 쓰기 실패: ${String(error)}`);
        stream.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    })();

    return { stream, rowCount: first.total };
  }

  private toFilters(request: ProductExportRequest): NonNullable<ProductExportRequest['filters']> {
    const ids = request.ids?.filter(Boolean);

    // ids 경로는 mode='all' 로 간다. 기본값 'active' 를 쓰면 목록에서 작성중(draft)이나
    // 판매안함(inactive) 행을 골라 내려받았을 때 빈 파일이 나온다 — 화면에 보이는 걸
    // 선택했는데 결과가 비는 건 사용자가 원인을 알 수 없는 실패다.
    return ids?.length ? { ids, deleted: false as const, mode: 'all' as const } : { ...(request.filters ?? {}) };
  }

  private async loadBatch(
    filters: NonNullable<ProductExportRequest['filters']>,
    page: number,
  ): Promise<{ data: MasterListItem[]; total: number }> {
    const result = await this.productMastersService.getMasters({ ...filters, page, limit: BATCH_SIZE }, undefined, {
      maxLimit: BATCH_SIZE,
      withPreviews: false,
    });
    return { data: result.data, total: result.total };
  }

  private toRows(items: MasterListItem[], supplierNames: Map<string, string>): ExportRow[] {
    return items.map((item) => {
      const summary = ProductMasterMapper.toProductSummary({ ...item.product, ...item.aggregate });
      return {
        ...summary,
        supplierName: summary.supplierId ? (supplierNames.get(summary.supplierId) ?? null) : null,
      };
    });
  }

  /**
   * 공급처 id→이름. 공급처는 수십 종이라 전량을 한 번 받아 맵으로 쓴다
   * (행마다 조회하면 1만 번이 된다).
   */
  private async loadSupplierNames(): Promise<Map<string, string>> {
    const { data } = await this.suppliersService.getSuppliers({ page: 1, limit: 100 });
    return new Map(data.map((s) => [s.id, s.name]));
  }
}
