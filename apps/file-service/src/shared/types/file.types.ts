import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { uploads, fileReferences, fileContexts } from '../../database/schema';

export type Upload = InferSelectModel<typeof uploads>;
export type NewUpload = InferInsertModel<typeof uploads>;
export type UpdateUpload = Partial<Omit<NewUpload, 'id' | 'createdAt'>>;

export type FileReference = InferSelectModel<typeof fileReferences>;
export type NewFileReference = InferInsertModel<typeof fileReferences>;

export type FileContext = InferSelectModel<typeof fileContexts>;
export type NewFileContext = InferInsertModel<typeof fileContexts>;
export type UpdateFileContext = Partial<Omit<NewFileContext, 'id' | 'createdAt'>>;
