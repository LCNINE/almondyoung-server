# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Almondyoung Server** is a microservices-based integrated logistics management system built on NestJS, implementing a comprehensive warehouse management system (WMS), product information management (PIM), and main server functionality.

### Architecture
- **Monorepo Structure**: NestJS-based monorepo with multiple applications
- **Database**: PostgreSQL with Drizzle ORM and postgres.js client 
- **Event Sourcing**: Stock management using event sourcing with `stock_events` as the source of truth and `stock_summary` projections
- **Microservices**: Three main applications - WMS, PIM, and almondyoung-server

### Key Applications
1. **WMS (`apps/wms`)**: Warehouse Management System for inventory, inbound/outbound operations, movement tracking
2. **PIM (`apps/pim`)**: Product Information Management for product masters, variants, categories, and sales channels
3. **Main Server (`apps/almondyoung-server`)**: Core server application

## Development Commands

### Build & Start Commands
```bash
# Build entire project
npm run build

# Build specific applications
npm run build:wms

# Development servers
npm run start:dev                # Main server
npm run start:wms:dev           # WMS service
npm run start:prod              # Production mode

# Production builds
npm run start:prod
npm run start:wms:prod          # node dist/apps/wms/main.js
```

### Database Operations
```bash
# WMS Database (Drizzle)
npm run db:generate.wms         # Generate migrations
npm run db:push.wms            # Push schema changes
npm run db:push.wms:test       # Test database

# PIM Database (Drizzle)
npm run db:generate:pim        # Generate migrations
npm run db:migrate:pim         # Run migrations
npm run db:push:pim           # Push schema changes
```

### Testing
```bash
# Unit tests
npm run test
npm run test:watch

# WMS-specific tests
npm run wms:test
npm run wms:test:watch
npm run wms:test:debug

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

### Code Quality
```bash
npm run lint                   # ESLint with auto-fix
npm run format                 # Prettier formatting
```

## Architecture Guidelines

### Database Layer
- **Schema Location**: `apps/wms/database/schemas/wms-schema.ts` (WMS), `apps/pim/src/schema.ts` (PIM)
- **ORM**: Drizzle ORM with PostgreSQL
- **Connection**: Each microservice uses `DbModule.forRoot()` with dedicated schema

### Transaction Management (WMS-specific)
Follow strict transaction propagation rules defined in `.cursor/rules/wms-transaction-rule.mdc`:

#### DbTx Import and Helper
```typescript
// Import from WMS schema only
import { DbTx } from '../database/schemas/wms-schema';

// Standard transaction helper in service classes
private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
  return tx ? fn(tx) : this.db.transaction(fn);
}
```

#### Method Signatures
- **Public methods**: End with `tx?: DbTx` parameter
- **Private helpers**: Require `tx: DbTx` parameter
```typescript
// Public service method
async createOrder(dto: CreateOrderDto, tx?: DbTx) { }

// Private helper method
private async validateStock(tx: DbTx, skuId: string) { }
```

#### Core Query Patterns
- **Prohibited**: `db.query.*`, `with` relations, `any`/`as` casting
- **Required**: Explicit core queries using `select().from().innerJoin().where().orderBy()`
- **Operators**: Use Drizzle operators (`eq`, `and`, `lt`, etc.)

### Event Sourcing (WMS)
- **Event Table**: `stock_events` - immutable audit trail of all stock changes
- **Projection Table**: `stock_summary` - current state aggregations with optimistic locking (`version` field)
- **Event Types**: `IN`, `OUT`, `ADJUST`, `MOVE`, `RESERVE`, `CONFIRM`, `RELEASE`, `CANCEL`

### Module Structure
Each major feature follows this pattern:
```
src/
├── [feature]/
│   ├── controllers/          # REST controllers
│   ├── services/            # Business logic
│   ├── dto/                 # Data transfer objects
│   ├── [feature].module.ts  # NestJS module
```

### Key WMS Modules
- **InventoryModule**: Stock management, SKU management, product matching
- **InboundModule**: Receiving, putaway, purchase orders
- **OutboundModule**: Picking, packing, shipping tasks
- **MovementModule**: Inter/intra-warehouse transfers
- **OrderModule**: Order processing and fulfillments

## Important Implementation Notes

### Type Safety Rules
- **Enum Usage**: Only use enum values defined in schema (e.g., use `'drop_ship'`, never non-existent values like `'direct_ship'`)
- **Nullable Handling**: Always normalize nullable fields:
  - Strings: `value ?? ''`
  - Numbers: `value ?? 0`
  - Dates: `value ?? undefined`
- **No Type Casting**: Avoid `any` and `as` casting unless absolutely necessary with team approval

### Common Patterns
- **Location Management**: 2D coordinate system with FIFO ranking
- **Stock Reservations**: Timeout-based reservation system
- **Product Matching**: Strategy pattern for variant/option/void matching

### Current Implementation Status
- ✅ **Complete**: Inventory management, inbound operations, outbound task creation, movement tracking
- 🚧 **Partial**: Outbound picking/packing logic, purchase orders
- ❌ **Missing**: Reservation/allocation, returns processing, shipment tracking, audit services

### Environment Variables
- `DATABASE_URL`: PostgreSQL connection string
- `PORT`: Server port (note: some code uses `process.env.port` - should be `PORT`)

## Testing Guidelines
- WMS uses dedicated Jest config: `apps/wms/jest.config.js`
- Use TestContainers for integration tests with PostgreSQL
- Event sourcing tests should verify both event creation and projection updates

## Common Gotchas
1. **Transaction Propagation**: Always pass `tx` parameter through service call chains
2. **Schema Imports**: Import `DbTx` only from `wms-schema.ts`, never create local type aliases
3. **Event Ordering**: Stock events must maintain proper sequence for projection accuracy
4. **Optimistic Locking**: Handle version conflicts in `stock_summary` updates
5. **Module Registration**: Some controllers lack `@Controller` decorator (Return/Shipment/Reservation)