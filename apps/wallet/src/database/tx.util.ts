import { DbService } from '@app/db';
import type { WalletSchema } from '../schema';
import type { DbTx } from '../types';

export async function inTx<T>(
  dbService: DbService<WalletSchema>,
  fn: (tx: DbTx) => Promise<T>,
  tx?: DbTx,
): Promise<T> {
  return tx ? fn(tx) : dbService.db.transaction(fn);
}
