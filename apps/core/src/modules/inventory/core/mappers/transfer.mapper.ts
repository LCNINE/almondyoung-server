import { MovementJob, MovementJobLine } from '../../schema/inventory.schema';
import {
  TransferJobWithLinesDto,
  TransferJobLineDto,
  TransferJobWithLineCountDto,
  BaseTransferJobDto,
} from '../dto/transfer/transfer-response.dto';

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
  static toDto(job: MovementJob): BaseTransferJobDto {
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
    };
  }
  static toWithLinesDto(job: MovementJob, lines?: MovementJobLine[]): TransferJobWithLinesDto {
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
      lines: lines?.map((line) => TransferJobLineMapper.toDto(line)),
    };
  }

  static toWithLineCountDto(job: MovementJob, lineCount: number): TransferJobWithLineCountDto {
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
      lineCount: lineCount,
    };
  }
}
