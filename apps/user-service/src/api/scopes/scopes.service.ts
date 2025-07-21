import { DbService, InjectDb } from '@app/db';
import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as schema from '../../../database/drizzle/schema';
import { SetUserScopesDto } from './dto/set-user-scopes.dto';
import { eq } from 'drizzle-orm';

@Injectable()
export class ScopesService {
  constructor(@InjectDb() private readonly dbService: DbService<schema.User>) {}

  async createScopes(UserScopesDto: SetUserScopesDto) {
    const { scopes, description } = UserScopesDto;

    try {
      // 스코프 중복 확인
      const exists = await this.dbService.db
        .select()
        .from(schema.scopes)
        .where(eq(schema.scopes.scopeName, scopes))
        .limit(1);

      if (exists.length > 0) {
        throw new BadRequestException(`이미 존재하는 스코프입니다: ${scopes}`);
      }

      await this.dbService.db.insert(schema.scopes).values({
        scopeName: scopes,
        description: description,
      });
    } catch (err) {
      console.error('[ScopesService.createScopes] error:', err);
      throw new InternalServerErrorException(
        '스코프 생성 중 오류가 발생했습니다.',
      );
    }
  }
}
