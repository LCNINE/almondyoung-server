# Design Document

## Overview

This document describes the technical design for migrating the membership subscription service from the current 9-table schema to the CTO-approved 7-table simplified model. The migration will be performed in phases to ensure zero downtime and data integrity.

## Architecture

### Current Schema (Legacy)
```
subscription_tiers → subscription_plans → subscriptions
                                       ↓
subscription_rights ← subscription_events
        ↓
pause_affected_rights ← subscription_pauses
        ↓
pause_usage_tracker
        ↓
subscription_policies
```

### Target Schema (CTO Approved)
```
tiers → plan → subscription_contracts
              ↓
subscription_entitlement ← event_batches
        ↓
pause_entitlement_voids ← pause_periods
        ↓
pause_usage_per_year (VIEW)
```

## Components and Interfaces

### 1. Schema Transformation Layer

**Purpose:** Handle the mapping between old and new schema structures during migration.

**Key Components:**
- `SchemaMapper`: Maps data between old and new table structures
- `MigrationValidator`: Validates data integrity during migration
- `DualWriteHandler`: Manages writes to both old and new schemas during transition

```typescript
interface SchemaMapper {
  mapSubscriptionToContract(subscription: LegacySubscription): SubscriptionContract;
  mapRightsToEntitlement(rights: LegacyRights): SubscriptionEntitlement;
  mapEventsToEventBatches(events: LegacyEvent[]): EventBatch[];
}
```

### 2. Migration Service

**Purpose:** Orchestrate the phased migration process.

```typescript
interface MigrationService {
  executePhase1(): Promise<void>; // Create new tables
  executePhase2(): Promise<void>; // Migrate data
  executePhase3(): Promise<void>; // Update code references
  executePhase4(): Promise<void>; // Remove old tables
  rollback(phase: number): Promise<void>;
}
```

### 3. Pause Mapping Service

**Purpose:** Handle the complex pause-entitlement relationship mapping.

```typescript
interface PauseMappingService {
  createPauseEntitlementVoid(
    pauseId: string,
    entitlementId: string,
    originalEndsAt: Date,
    adjustedEndsAt: Date
  ): Promise<PauseEntitlementVoid>;
  
  getPauseAffectedEntitlements(pauseId: string): Promise<PauseEntitlementVoid[]>;
  getEntitlementPauseHistory(entitlementId: string): Promise<PauseEntitlementVoid[]>;
}
```

## Data Models

### New Table Structures

#### 1. tiers (from subscription_tiers)
```sql
CREATE TABLE tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  rank INTEGER NOT NULL UNIQUE, -- renamed from priority_level
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  -- removed: name
);
```

#### 2. plan (from subscription_plans)
```sql
CREATE TABLE plan (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id UUID NOT NULL REFERENCES tiers(id),
  price INTEGER NOT NULL,
  duration_days INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KRW',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  -- removed: trial_days
);
```

#### 3. subscription_contracts (from subscriptions)
```sql
CREATE TABLE subscription_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  plan_id UUID NOT NULL REFERENCES plan(id),
  next_billing_date DATE,
  lead_days INTEGER NOT NULL DEFAULT 0, -- new field
  is_voided BOOLEAN NOT NULL DEFAULT false,
  voided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  -- removed: status, started_at, previous_subscription_id, change_type, adjustment_amount, void_reason, updated_at
);
```

#### 4. subscription_entitlement (from subscription_rights)
```sql
CREATE TABLE subscription_entitlement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  tier_id UUID NOT NULL REFERENCES tiers(id),
  starts_at DATE NOT NULL,
  ends_at DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  is_current BOOLEAN NOT NULL DEFAULT true,
  source_batch_id UUID REFERENCES event_batches(id),
  closed_batch_id UUID REFERENCES event_batches(id),
  paused_at TIMESTAMPTZ
);
```

#### 5. event_batches (from subscription_events)
```sql
CREATE TABLE event_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL, -- renamed from event_type
  admin_id UUID, -- new field
  effective_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  -- removed: user_id, subscription_id, event_payload, initiated_by, topic_name, publish_status, retry_count
);
```

#### 6. pause_periods (from subscription_pauses)
```sql
CREATE TABLE pause_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  starts_at DATE NOT NULL,
  ends_at DATE NOT NULL,
  reason TEXT, -- new field for pause reason
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  -- removed: subscription_id, status, actual_resumed_at
);
```

#### 7. pause_entitlement_voids (from pause_affected_rights)
```sql
CREATE TABLE pause_entitlement_voids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pause_id UUID NOT NULL REFERENCES pause_periods(id),
  entitlement_id UUID NOT NULL REFERENCES subscription_entitlement(id), -- renamed from right_id
  original_ends_at DATE NOT NULL,
  adjusted_ends_at DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Views for Analytics

#### pause_usage_per_year (replaces pause_usage_tracker)
```sql
CREATE VIEW pause_usage_per_year AS
SELECT 
  user_id,
  EXTRACT(YEAR FROM starts_at) AS year,
  COUNT(*) AS pause_count,
  SUM(ends_at - starts_at) AS total_paused_days,
  MAX(starts_at) AS last_pause_date
FROM pause_periods 
GROUP BY user_id, EXTRACT(YEAR FROM starts_at);
```

## Error Handling

### Migration Error Scenarios

1. **Data Integrity Violations**
   - Foreign key constraint failures during data migration
   - Duplicate key violations
   - Data type conversion errors

2. **System Availability Issues**
   - Database connection failures during migration
   - Long-running transactions causing locks
   - Memory issues with large data sets

3. **Application Compatibility Issues**
   - API breaking changes
   - Service layer incompatibilities
   - Missing data mappings

### Error Recovery Strategy

```typescript
class MigrationErrorHandler {
  async handleDataIntegrityError(error: DataIntegrityError): Promise<void> {
    // Log error details
    // Attempt data correction
    // If correction fails, rollback to previous phase
  }
  
  async handleSystemError(error: SystemError): Promise<void> {
    // Pause migration
    // Wait for system recovery
    // Resume from last checkpoint
  }
  
  async handleCompatibilityError(error: CompatibilityError): Promise<void> {
    // Enable compatibility mode
    // Fix code issues
    // Continue migration
  }
}
```

## Testing Strategy

### 1. Unit Testing
- Test individual data mapping functions
- Test migration service methods
- Test pause mapping logic

### 2. Integration Testing
- Test end-to-end migration process in staging environment
- Test API compatibility during migration
- Test data integrity after migration

### 3. Performance Testing
- Test migration performance with production-sized datasets
- Test query performance with new schema
- Test view performance for analytics queries

### 4. Rollback Testing
- Test rollback procedures for each migration phase
- Test data consistency after rollback
- Test application functionality after rollback

## Migration Phases

### Phase 1: Schema Preparation
- Create new tables alongside existing ones
- Create migration utilities and validation scripts
- Set up monitoring and logging

### Phase 2: Data Migration
- Implement dual-write mechanism
- Migrate historical data in batches
- Validate data integrity continuously

### Phase 3: Code Migration
- Update Drizzle ORM schema definitions
- Update service layer to use new tables
- Update API layer with backward compatibility

### Phase 4: Cleanup
- Remove dual-write mechanism
- Drop old tables
- Update documentation and monitoring

## Performance Considerations

### Indexing Strategy
```sql
-- Critical indexes for new schema
CREATE INDEX idx_subscription_entitlement_user_current ON subscription_entitlement(user_id, is_current);
CREATE INDEX idx_subscription_entitlement_tier_dates ON subscription_entitlement(tier_id, starts_at, ends_at);
CREATE INDEX idx_pause_entitlement_voids_pause ON pause_entitlement_voids(pause_id);
CREATE INDEX idx_pause_entitlement_voids_entitlement ON pause_entitlement_voids(entitlement_id);
CREATE INDEX idx_pause_periods_user_dates ON pause_periods(user_id, starts_at, ends_at);
```

### Query Optimization
- Use materialized views for frequently accessed analytics
- Implement query result caching for expensive operations
- Optimize JOIN operations with proper indexing