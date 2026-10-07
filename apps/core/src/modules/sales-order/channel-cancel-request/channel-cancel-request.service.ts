import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsSchema } from '../../inventory/schema/inventory.schema';
import { CancelRequestInput, ChannelCancelRequestManager } from './channel-cancel-request.manager';
import { ChannelCancelRequestReader } from './channel-cancel-request.reader';
import { CancelRequestView, toCancelRequestView } from './channel-cancel-request.types';

@Injectable()
export class ChannelCancelRequestService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly db: DbService<typeof wmsSchema>,
    private readonly manager: ChannelCancelRequestManager,
    private readonly reader: ChannelCancelRequestReader,
  ) {}

  request(input: CancelRequestInput): Promise<CancelRequestView> {
    return this.manager.request(input);
  }

  findBySourceKey(salesOrderId: string, sourceKey: string): Promise<CancelRequestView | null> {
    return this.db.run(async (tx) => {
      const row = await this.reader.findBySourceKey(salesOrderId, sourceKey, tx);
      return row ? toCancelRequestView(row) : null;
    });
  }

  latestFor(salesOrderId: string): Promise<CancelRequestView | null> {
    return this.db.run(async (tx) => {
      const row = await this.reader.latestFor(salesOrderId, tx);
      return row ? toCancelRequestView(row) : null;
    });
  }
}
