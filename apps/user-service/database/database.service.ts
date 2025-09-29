import { DbService, InjectDb } from '@app/db';
import { Injectable, OnModuleInit } from '@nestjs/common';

import { seedDatabase } from './seed';
import { userServiceSchema, type UserServiceSchema } from './drizzle/schema';

@Injectable()
export class DatabaseService implements OnModuleInit {
  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
  ) {}

  async onModuleInit() {
    // 앱 시작 시 기본 데이터 시드
    try {
      console.log('기본 데이터 시드 작업 시작...');
      await seedDatabase(this.dbService);
      console.log('기본 데이터 시드 작업 완료!');
    } catch (error) {
      console.error('기본 데이터 시드 중 오류 발생:', error);
    }
  }
}
