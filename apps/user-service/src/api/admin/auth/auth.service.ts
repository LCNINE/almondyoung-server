import { DbService, InjectDb } from '@app/db';
import * as schema from '../../../../database/drizzle/schema';

export class AuthService {
  constructor(@InjectDb() private readonly dbService: DbService<schema.User>) {}
}
