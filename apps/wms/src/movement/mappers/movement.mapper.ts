import { MovementJob, MovementJobLine, MovementWorkLog } from '../../../database/schemas/wms-schema';
import {
  BaseMovementJobDto,
  MovementJobLineDto,
  MovementJobWithLinesDto,
  MovementWorkLogDto,
} from '../dto/movement-response.dto';

export class MovementJobLineMapper {
  static toDto(line: MovementJobLine): MovementJobLineDto {
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

export class MovementJobMapper {
  static toDto(job: MovementJob): BaseMovementJobDto {
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

  static toWithLinesDto(job: MovementJob, lines: MovementJobLine[]): MovementJobWithLinesDto {
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
      lines: lines.map(line => MovementJobLineMapper.toDto(line)),
    };
  }
}

export class MovementWorkLogMapper {
  static toDto(log: MovementWorkLog): MovementWorkLogDto {
    return {
      id: log.id,
      type: log.type,
      timestamp: log.timestamp.toISOString(),
      jobId: log.jobId,
      lineId: log.lineId,
      skuId: log.skuId,
      warehouseId: log.warehouseId,
      fromLocationId: log.fromLocationId,
      toLocationId: log.toLocationId,
      quantity: log.quantity,
      eventId: log.eventId,
      reason: log.reason,
    };
  }
}

