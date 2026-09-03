import { TxFor } from '@app/db';
import { archiveSchema } from './schema/archive.schema';

export type ArchiveSchema = typeof archiveSchema;

/** A transaction handle — for DbService.run callbacks and tx propagation. */
export type ArchiveTx = TxFor<ArchiveSchema>;
