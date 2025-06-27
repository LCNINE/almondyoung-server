import { DB_CONNECTION, DbModule, DbService, InjectDb } from '@app/db';
import { Inject, Injectable } from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from '../../database/drizzle/schema';

@Injectable()
export class UserService {
  constructor(
    @InjectDb() private readonly dbService: DbService<schema.UserSchema>,
  ) {}

  findAll() {
    return `This action returns all user`;
  }

  findOne(id: number) {
    return `This action returns a #${id} user`;
  }

  update(id: number, updateUserDto: UpdateUserDto) {
    return `This action updates a #${id} user`;
  }

  remove(id: number) {
    return `This action removes a #${id} user`;
  }
}
