import { MovementJob, MovementJobLine } from 'apps/wms/database/schemas/wms-schema';
import { TransferJobDto, TransferJobLineDto } from '../dto/transfer/transfer-response.dto';

export class TransferJobLineMapper {
  static toDto(line: MovementJobLine): TransferJobLineDto {
    return {
      id: line.id,
      jobId: line.jobId,
      skuId: line.skuId,
      quantity: line.quantity,
      fromLocationId: line.fromLocationId,
      toLocationId: line.toLocationId,
      eventId: line.eventId,
      memo: line.memo,
      createdAt: line.createdAt.toISOString(),
    };
  }
}

export class TransferJobMapper {
  static toDto(job: MovementJob, lines?: MovementJobLine[]): TransferJobDto {
    return {
      id: job.id,
      warehouseId: job.warehouseId,
      occurredAt: job.occurredAt.toISOString(),
      totalQuantity: job.totalQuantity,
      journalId: job.journalId,
      actorId: job.actorId,
      memo: job.memo,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      lines: lines?.map(line => TransferJobLineMapper.toDto(line)),
    };
  }
}

