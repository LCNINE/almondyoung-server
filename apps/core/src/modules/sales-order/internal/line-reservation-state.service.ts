import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import type { SalesOrderLineReservationStatePayload } from '@packages/event-contracts/streams/orders.stream';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import {
  findOrderIdsByChannelOrderItemIds,
  readLineReservationCandidates,
  readLineReservationStates,
} from '../line-reservation-state/line-reservation-state.reader';
import type {
  LineReservationCandidatesRequestDto,
  LineReservationCandidatesResponse,
  LineReservationStatesResponse,
} from './line-reservation-state.dto';

/** 요청한 줄 id 마다 스냅샷의 줄을 찾아 붙이고, 못 찾은 id 는 `unknown` 으로 돌린다. */
export function assembleLineStates(
  requested: readonly string[],
  states: readonly SalesOrderLineReservationStatePayload[],
): LineReservationStatesResponse {
  const byItemId = new Map<string, LineReservationStatesResponse['lines'][number]>();
  for (const state of states) {
    for (const line of state.lines) {
      if (line.channelOrderItemId === null) continue;
      byItemId.set(line.channelOrderItemId, { ...line, salesOrderId: state.salesOrderId, orderedAt: state.orderedAt });
    }
  }
  const lines: LineReservationStatesResponse['lines'] = [];
  const unknown: string[] = [];
  for (const id of new Set(requested)) {
    const line = byItemId.get(id);
    if (line) lines.push(line);
    else unknown.push(id);
  }
  return { lines, unknown };
}

@Injectable()
export class LineReservationStateService {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  readStates(
    salesChannel: SalesOrderLineReservationStatePayload['salesChannel'],
    channelOrderItemIds: readonly string[],
    tx?: DbTx,
  ): Promise<LineReservationStatesResponse> {
    return this.dbService.run(async (trx) => {
      const found = await findOrderIdsByChannelOrderItemIds(trx, salesChannel, channelOrderItemIds);
      const states = await readLineReservationStates(
        trx,
        [...new Set(found.map((row) => row.salesOrderId))],
        new Date(),
      );
      return assembleLineStates(channelOrderItemIds, states);
    }, tx);
  }

  readCandidates(dto: LineReservationCandidatesRequestDto, tx?: DbTx): Promise<LineReservationCandidatesResponse> {
    return this.dbService.run((trx) => readLineReservationCandidates(trx, dto), tx);
  }
}
