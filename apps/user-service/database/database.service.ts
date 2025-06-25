import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PostgresJsDatabase, drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../database/drizzle/schema';
import { seedDatabase } from './seed';
// Use require for postgres to avoid ESM/CommonJS issues
const postgres = require('postgres');


// Define the type for the postgres client
type PostgresClient = ReturnType<typeof postgres>;

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private client: PostgresClient;
  public db: PostgresJsDatabase<typeof schema>;

  constructor() {
    // Connection string from environment variables
    const connectionString = process.env.DATABASE_URL || 
      'postgres://postgres:postgres@localhost:5432/almond';
    
    // Create postgres client
    this.client = postgres(connectionString, { 
      max: 10, // Connection pool size
      ssl: process.env.NODE_ENV === 'production' // Use SSL in production
    });
    
    // Initialize drizzle with our schema
    this.db = drizzle(this.client, { schema });
  }

  async onModuleInit() {
    // 앱 시작 시 기본 데이터 시드
    try {
      console.log('기본 데이터 시드 작업 시작...');
      await seedDatabase(this);
      console.log('기본 데이터 시드 작업 완료!');
    } catch (error) {
      console.error('기본 데이터 시드 중 오류 발생:', error);
    }
  }

  async onModuleDestroy() {
    // Close the postgres connection pool when application shuts down
    if (this.client) {
      await this.client.end();
    }
  }
}
