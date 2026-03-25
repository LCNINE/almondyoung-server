import { InboundReceipt, InboundReceiptLine } from '../../../database/schemas/wms-schema';
import {
  InboundReceiptLineDto,
  BaseInboundReceiptDto,
  IndividualInboundResponseDto,
  SimpleInboundResponseDto,
} from '../dto/inbound-response.dto';

export class InboundReceiptLineMapper {
  static toDto(line: InboundReceiptLine): InboundReceiptLineDto {
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
      planItemId: line.planItemId,
      createdAt: line.createdAt.toISOString(),
      updatedAt: line.updatedAt.toISOString(),
    };
  }
}

export class InboundReceiptMapper {
  static toBaseDto(receipt: InboundReceipt): BaseInboundReceiptDto {
    return {
      id: receipt.id,
      method: receipt.method,
      warehouseId: receipt.warehouseId,
      locationId: receipt.locationId,
      occurredAt: receipt.occurredAt.toISOString(),
      status: receipt.status,
      totalQuantity: receipt.totalQuantity,
      journalId: receipt.journalId,
      createdAt: receipt.createdAt.toISOString(),
      updatedAt: receipt.updatedAt.toISOString(),
    };
  }

  static toIndividualResponseDto(receipt: InboundReceipt, line: InboundReceiptLine): IndividualInboundResponseDto {
    return {
      ...InboundReceiptMapper.toBaseDto(receipt),
      line: InboundReceiptLineMapper.toDto(line),
    };
  }

  static toSimpleResponseDto(receipt: InboundReceipt, lines: InboundReceiptLine[]): SimpleInboundResponseDto {
    return {
      ...InboundReceiptMapper.toBaseDto(receipt),
      lines: lines.map((line) => InboundReceiptLineMapper.toDto(line)),
    };
  }
}
