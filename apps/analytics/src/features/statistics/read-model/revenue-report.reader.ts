import { Injectable } from '@nestjs/common';
import { RevenueReportRepository } from './revenue-report.repository';

@Injectable()
export class RevenueReportReader {
  constructor(private readonly repository: RevenueReportRepository) {}
  get(year: number, includeHistory = true) {
    return this.repository.get(year, includeHistory);
  }
  history(year: number) {
    return this.repository.history(year);
  }
  raw(year: number, page: number, after?: string, through?: string) {
    return this.repository.raw(year, page, after, through);
  }
}
