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
   * 행은 한 번에 조회하고 시트 쓰기는
   * WorkbookWriter 로 스트리밍한다 — 비스트리밍 Workbook 은 셀 객체를 전부
   * 메모리에 들고 있어 10,021행 × 19열이면 그쪽이 먼저 터진다.
   *
   * ponytail: 조회는 단일 배치다. MAX_ROWS(5만)까지는 이 방식으로 버틴다.
   * 그 위로 올라가면 getMasters 에 keyset 페이징을 열고 배치마다 addRow 하도록
   * 바꾼다 — 시트 쓰기가 이미 스트리밍이라 그때 조회만 갈아끼우면 된다.
   */
  async export(request: ProductExportRequest): Promise<{ stream: Readable; rowCount: number }> {
    const columns = resolveColumns(request.columns);
    const rows = await this.loadRows(request);

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
        for (const row of rows) {
          sheet.addRow(columns.map((c) => c.value(row))).commit();
        }
        sheet.commit();
        await workbook.commit();
      } catch (error) {
        this.logger.error(`엑셀 쓰기 실패: ${String(error)}`);
        stream.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    })();

    return { stream, rowCount: rows.length };
  }

  private async loadRows(request: ProductExportRequest): Promise<ExportRow[]> {
    const ids = request.ids?.filter(Boolean);

    // page 를 넘기지 않으면 getMasters 가 전량을 반환한다(내부 limit 99999).
    //
    // ids 경로는 mode='all' 로 간다. 기본값 'active' 를 쓰면 목록에서 작성중(draft)이나
    // 판매안함(inactive) 행을 골라 내려받았을 때 빈 파일이 나온다 — 화면에 보이는 걸
    // 선택했는데 결과가 비는 건 사용자가 원인을 알 수 없는 실패다.
    const filters = ids?.length
      ? { ids, deleted: false as const, mode: 'all' as const }
      : { ...(request.filters ?? {}), page: undefined, limit: undefined };

    const result = await this.productMastersService.getMasters(filters);

    if (result.total > MAX_ROWS) {
      throw new BadRequestError(
        `내보낼 상품이 ${result.total.toLocaleString()}건입니다. ` +
          `한 번에 ${MAX_ROWS.toLocaleString()}건까지만 가능하니 필터를 좁혀주세요.`,
      );
    }

    const summaries = result.data.map((item) =>
      ProductMasterMapper.toProductSummary({ ...item.product, ...item.aggregate }),
    );

    const supplierNames = await this.loadSupplierNames();

    return summaries.map((summary) => ({
      ...summary,
      supplierName: summary.supplierId ? (supplierNames.get(summary.supplierId) ?? null) : null,
    }));
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
