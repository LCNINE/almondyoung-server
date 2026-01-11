import { DbService } from '@app/db';
import { analyticsSchema } from './schema';

export type DbTx = Parameters<
  Parameters<DbService<typeof analyticsSchema>['db']['transaction']>[0]
>[0];
