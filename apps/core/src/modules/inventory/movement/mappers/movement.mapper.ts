import { ReplayableDates, storedDateToIso } from '../../shared/mappers/stored-date';
import { MovementJob, MovementJobLine, MovementWorkLog } from '../../schema/inventory.schema';
import {
  BaseMovementJobDto,
  MovementJobLineDto,
  MovementJobWithLinesDto,
  MovementWorkLogDto,
} from '../dto/movement-response.dto';

export class MovementJobLineMapper {
  static toDto(line: ReplayableDates<MovementJobLine>): MovementJobLineDto {
    return {
      id: line.id,
      jobId: line.jobId,
      skuId: line.skuId,
      quantity: line.quantity,
      fromLocationId: line.fromLocationId,
      toLocationId: line.toLocationId,
      eventId: line.eventId,
      memo: line.memo,
      createdAt: storedDateToIso(line.createdAt),
    };
  }
}

export class MovementJobMapper {
  static toDto(job: ReplayableDates<MovementJob>): BaseMovementJobDto {
    return {
      id: job.id,
      warehouseId: job.warehouseId,
      occurredAt: storedDateToIso(job.occurredAt),
      totalQuantity: job.totalQuantity,
      journalId: job.journalId,
      actorId: job.actorId,
      memo: job.memo,
      createdAt: storedDateToIso(job.createdAt),
      updatedAt: storedDateToIso(job.updatedAt),
    };
  }

  static toWithLinesDto(
    job: ReplayableDates<MovementJob>,
    lines: ReplayableDates<MovementJobLine>[],
  ): MovementJobWithLinesDto {
    return {
      id: job.id,
      warehouseId: job.warehouseId,
      occurredAt: storedDateToIso(job.occurredAt),
      totalQuantity: job.totalQuantity,
      journalId: job.journalId,
      actorId: job.actorId,
      memo: job.memo,
      createdAt: storedDateToIso(job.createdAt),
      updatedAt: storedDateToIso(job.updatedAt),
      lines: lines.map((line) => MovementJobLineMapper.toDto(line)),
    };
  }
}

export class MovementWorkLogMapper {
  static toDto(log: ReplayableDates<MovementWorkLog>): MovementWorkLogDto {
    return {
      id: log.id,
      type: log.type,
      timestamp: storedDateToIso(log.timestamp),
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
