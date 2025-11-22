import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { uploads, fileReferences } from '../../database/schema';

export type Upload = InferSelectModel<typeof uploads>;
export type NewUpload = InferInsertModel<typeof uploads>;
export type UpdateUpload = Partial<Omit<NewUpload, 'id' | 'createdAt'>>;

export type FileReference = InferSelectModel<typeof fileReferences>;
export type NewFileReference = InferInsertModel<typeof fileReferences>;

