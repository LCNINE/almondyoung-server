import { DbService } from '@app/db';
import * as schema from '../shared/schemas/schema';

export type WalletTx = Parameters<
  DbService<typeof schema>['db']['transaction']
>[0] extends (tx: infer T) => any
  ? T
  : never;
