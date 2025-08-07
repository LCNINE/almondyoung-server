import { DbService } from '@app/db';
import { NestFactory } from '@nestjs/core';
import { DatabaseModule } from './database.module';
import * as schema from './drizzle/schema';
import { seedDatabase } from './seed';

async function bootstrap() {
  // Create a standalone application with just the DatabaseModule
  const app = await NestFactory.createApplicationContext(DatabaseModule);

  try {
    // Get the database service
    const dbService = app.get(DbService<schema.User>);

    console.log('===============================');
    console.log('🌱 시드 CLI 도구 실행 중...');
    console.log('===============================');

    // Run the seed function
    await seedDatabase(dbService);

    console.log('===============================');
    console.log('✅ 시드 작업이 완료되었습니다!');
    console.log('===============================');
  } catch (error) {
    console.error('시드 작업 중 오류가 발생했습니다:', error);
  } finally {
    // Close the application when done
    await app.close();
  }

  // Exit the process
  process.exit(0);
}

// Run the bootstrap function
bootstrap();
