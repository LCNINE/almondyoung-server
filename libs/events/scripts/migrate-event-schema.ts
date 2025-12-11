#!/usr/bin/env ts-node

import * as postgres from 'postgres';

function getDatabaseUrl(): string {
  const url = process.argv[2] || process.env.DATABASE_URL;
  
  if (!url) {
    console.error('❌ DATABASE_URL is required');
    console.error('Usage: npm run migrate:event <database-url>');
    console.error('   or: DATABASE_URL=<url> npm run migrate:event');
    process.exit(1);
  }
  
  return url;
}

const DATABASE_URL = getDatabaseUrl();

const eventSchemaSql = `
-- Create event schema
CREATE SCHEMA IF NOT EXISTS event;

-- Create outbox_events table
CREATE TABLE IF NOT EXISTS event.outbox_events (
  id serial PRIMARY KEY,
  
  -- Stream 정보
  topic varchar(100) NOT NULL,
  
  -- 이벤트 식별
  aggregate_type varchar(50) NOT NULL,
  aggregate_id varchar(100) NOT NULL,
  event_type varchar(100) NOT NULL,
  
  -- 페이로드 (MessageEnvelope 전체)
  payload jsonb NOT NULL,
  
  -- 상태 관리
  status varchar(20) NOT NULL DEFAULT 'PENDING',
  
  -- 타임스탬프
  created_at timestamp NOT NULL DEFAULT now(),
  published_at timestamp,
  failed_at timestamp,
  
  -- 재시도 관리
  retry_count integer NOT NULL DEFAULT 0,
  error_message text
);

-- Create indexes
CREATE INDEX IF NOT EXISTS outbox_status_idx ON event.outbox_events (status, created_at);
CREATE INDEX IF NOT EXISTS outbox_topic_idx ON event.outbox_events (topic);
`;

async function main() {
  console.log('🔧 Migrating event schema...');
  console.log(`📍 Target DB: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);

  const sql = postgres(DATABASE_URL);

  try {
    await sql.unsafe(eventSchemaSql);
    console.log('✅ Event schema migration completed successfully!');
    console.log('');
    console.log('📋 Created:');
    console.log('  - event schema');
    console.log('  - event.outbox_events table');
    console.log('  - outbox_status_idx index');
    console.log('  - outbox_topic_idx index');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();


