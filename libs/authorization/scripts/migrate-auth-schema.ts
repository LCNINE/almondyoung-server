#!/usr/bin/env ts-node

import * as postgres from 'postgres';

function getDatabaseUrl(): string {
  const url = process.argv[2] || process.env.DATABASE_URL;

  if (!url) {
    console.error('❌ DATABASE_URL is required');
    console.error('Usage: npm run migrate:auth <database-url>');
    console.error('   or: DATABASE_URL=<url> npm run migrate:auth');
    process.exit(1);
  }

  return url;
}

const DATABASE_URL = getDatabaseUrl();

const authSchemaSql = `
-- Create auth schema
CREATE SCHEMA IF NOT EXISTS auth;

-- Create roles table
CREATE TABLE IF NOT EXISTS auth.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(50) NOT NULL UNIQUE,
  description text,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

-- Create scopes table
CREATE TABLE IF NOT EXISTS auth.scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key varchar(100) NOT NULL UNIQUE,
  category varchar(50),
  description text,
  microservice_name varchar(50) NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL
);

-- Migrate role_scope_mapping: drop old table if it has role_id column, recreate with role_name
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'role_scope_mapping'
      AND column_name = 'role_id'
  ) THEN
    DROP TABLE auth.role_scope_mapping;
  END IF;
END $$;

-- Create role_scope_mapping table with role_name (no FK to auth.roles)
CREATE TABLE IF NOT EXISTS auth.role_scope_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name varchar(100) NOT NULL,
  scope_id uuid NOT NULL REFERENCES auth.scopes(id) ON DELETE CASCADE,
  created_at timestamp DEFAULT now() NOT NULL,
  UNIQUE(role_name, scope_id)
);

-- Create unique index on role_scope_mapping
CREATE UNIQUE INDEX IF NOT EXISTS role_scope_unique_idx ON auth.role_scope_mapping(role_name, scope_id);
`;

async function main() {
  console.log('🔧 Migrating auth schema...');
  console.log(`📍 Target DB: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);

  const sql = postgres(DATABASE_URL);

  try {
    await sql.unsafe(authSchemaSql);
    console.log('✅ Auth schema migration completed successfully!');
    console.log('');
    console.log('📋 Created/Updated:');
    console.log('  - auth schema');
    console.log('  - auth.roles table');
    console.log('  - auth.scopes table');
    console.log('  - auth.role_scope_mapping table (role_name based, no FK)');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
