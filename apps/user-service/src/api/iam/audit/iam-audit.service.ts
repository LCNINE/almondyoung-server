import { Injectable } from '@nestjs/common';
import type { IamAuditLogsQueryDto, IamAuditPageDto } from './dto/iam-audit.dto';
import { IamAuditReader } from './iam-audit.reader';

@Injectable()
export class IamAuditService {
  constructor(private readonly reader: IamAuditReader) {}

  page(query: IamAuditLogsQueryDto): Promise<IamAuditPageDto> {
    return this.reader.page(query);
  }
}
