# Requirements Document

## Introduction

This document outlines the requirements for migrating the current membership subscription service schema to the CTO-approved simplified model. The migration aims to reduce complexity while maintaining all essential functionality through a more streamlined database design.

## Requirements

### Requirement 1

**User Story:** As a system architect, I want to migrate from the current complex schema to the CTO-approved simplified model, so that the system becomes more maintainable and easier to understand.

#### Acceptance Criteria

1. WHEN the migration is complete THEN the system SHALL use only the 5 core tables: `tiers`, `plan`, `subscription_contracts`, `event_batches`, `pause_periods`, `pause_entitlement_voids`, and `subscription_entitlement`
2. WHEN the migration is complete THEN all legacy tables SHALL be removed: `subscription_tiers`, `subscription_plans`, `subscriptions`, `subscription_events`, `subscription_pauses`, `subscription_rights`, `pause_affected_rights`, `pause_usage_tracker`, `subscription_policies`
3. WHEN the migration is complete THEN all existing functionality SHALL be preserved with the new schema

### Requirement 2

**User Story:** As a developer, I want the pause functionality to be properly mapped, so that I can track which pause periods affected which entitlements and how.

#### Acceptance Criteria

1. WHEN a pause is created THEN the system SHALL record the mapping in `pause_entitlement_voids` table
2. WHEN a pause affects an entitlement THEN the system SHALL store both `original_ends_at` and `adjusted_ends_at` dates
3. WHEN querying pause history THEN the system SHALL be able to show which entitlements were affected by each pause period
4. WHEN a pause is created THEN the system SHALL store the reason in the `pause_periods.reason` column

### Requirement 3

**User Story:** As a system administrator, I want pause usage tracking to be handled through views instead of a dedicated table, so that the schema remains simple while still providing necessary analytics.

#### Acceptance Criteria

1. WHEN pause usage statistics are needed THEN the system SHALL calculate them from `pause_periods` table using SQL views
2. WHEN frequent access to pause statistics is required THEN the system SHALL use materialized views for performance
3. WHEN the migration is complete THEN the `pause_usage_tracker` table SHALL be removed
4. WHEN pause usage is queried THEN the system SHALL provide the same data as before: pause count, total paused days, last pause date per user per year

### Requirement 4

**User Story:** As a developer, I want all code references to be updated during migration, so that the application continues to work seamlessly with the new schema.

#### Acceptance Criteria

1. WHEN the migration is complete THEN all import statements SHALL reference the new table names
2. WHEN the migration is complete THEN all Drizzle ORM relations SHALL be updated to use new table names
3. WHEN the migration is complete THEN all service layer code SHALL use the new schema structure
4. WHEN the migration is complete THEN all existing API endpoints SHALL continue to work without breaking changes

### Requirement 5

**User Story:** As a data engineer, I want the migration to be performed safely with zero data loss, so that all existing subscription and entitlement data is preserved.

#### Acceptance Criteria

1. WHEN the migration starts THEN all existing data SHALL be backed up
2. WHEN data is migrated THEN all relationships SHALL be preserved correctly
3. WHEN the migration is complete THEN data integrity checks SHALL pass for all migrated records
4. WHEN the migration fails THEN the system SHALL be able to rollback to the previous state

### Requirement 6

**User Story:** As a system operator, I want the migration to be performed in phases, so that the system remains operational throughout the process.

#### Acceptance Criteria

1. WHEN Phase 1 begins THEN new tables SHALL be created alongside existing ones
2. WHEN Phase 2 begins THEN data SHALL be migrated while maintaining dual-write capability
3. WHEN Phase 3 begins THEN code SHALL be updated to use new schema while maintaining backward compatibility
4. WHEN Phase 4 begins THEN old tables SHALL be removed only after full verification
5. WHEN any phase fails THEN the system SHALL be able to continue operating on the previous schema