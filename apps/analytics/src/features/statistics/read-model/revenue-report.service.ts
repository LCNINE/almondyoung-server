import { Injectable } from '@nestjs/common';
import type { ExternalRevenueRowDto } from '../api/revenue-report.controller';
import { RevenueReportReader } from './revenue-report.reader';
import { RevenueReportManager } from './revenue-report.manager';

@Injectable()
export class RevenueReportService {
  constructor(
    private readonly reader: RevenueReportReader,
    private readonly manager: RevenueReportManager,
  ) {}

  get(year: number, includeHistory = true) {
    return this.reader.get(year, includeHistory);
  }
  history(year: number) {
    return this.reader.history(year);
  }
  raw(year: number, page: number, after?: string, through?: string) {
    return this.reader.raw(year, page, after, through);
  }
  import(rows: ExternalRevenueRowDto[], recordedBy?: string, batchId?: string) {
    return this.manager.import(rows, recordedBy, batchId);
  }
}
