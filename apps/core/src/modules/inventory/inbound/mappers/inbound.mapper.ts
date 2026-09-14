import { ReplayableDates, storedDateToIso } from '../../shared/mappers/stored-date';
import { InboundReceipt, InboundReceiptLine } from '../../schema/inventory.schema';
import {
  InboundReceiptLineDto,
  BaseInboundReceiptDto,
  IndividualInboundResponseDto,
  SimpleInboundResponseDto,
} from '../dto/inbound-response.dto';

export class InboundReceiptLineMapper {
  static toDto(line: ReplayableDates<InboundReceiptLine>): InboundReceiptLineDto {
    return {
      id: line.id,
      receiptId: line.receiptId,
      skuId: line.skuId,
      quantity: line.quantity,
      originLocationId: line.originLocationId,
      eventId: line.eventId,
      memo: line.memo,
      returnedQty: line.returnedQty,
      canceledQty: line.canceledQty,
      putawayFromOriginQty: line.putawayFromOriginQty,
      source: line.source,
      createdAt: storedDateToIso(line.createdAt),
      updatedAt: storedDateToIso(line.updatedAt),
    };
  }
}

export class InboundReceiptMapper {
  static toBaseDto(receipt: ReplayableDates<InboundReceipt>): BaseInboundReceiptDto {
    return {
      id: receipt.id,
      method: receipt.method,
      warehouseId: receipt.warehouseId,
      locationId: receipt.locationId,
      occurredAt: storedDateToIso(receipt.occurredAt),
      status: receipt.status,
      totalQuantity: receipt.totalQuantity,
      journalId: receipt.journalId,
      createdAt: storedDateToIso(receipt.createdAt),
      updatedAt: storedDateToIso(receipt.updatedAt),
    };
  }

  static toIndividualResponseDto(
    receipt: ReplayableDates<InboundReceipt>,
    line: ReplayableDates<InboundReceiptLine>,
  ): IndividualInboundResponseDto {
    return {
      ...InboundReceiptMapper.toBaseDto(receipt),
      line: InboundReceiptLineMapper.toDto(line),
    };
  }

  static toSimpleResponseDto(
    receipt: ReplayableDates<InboundReceipt>,
    lines: ReplayableDates<InboundReceiptLine>[],
  ): SimpleInboundResponseDto {
    return {
      ...InboundReceiptMapper.toBaseDto(receipt),
      lines: lines.map((line) => InboundReceiptLineMapper.toDto(line)),
    };
  }
}
