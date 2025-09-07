# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a NestJS-based microservices monorepo for **AlmondYoung's e-commerce backend system**. The project serves as the backend infrastructure for a new online mall that extends Medusa.js functionality and comprehensively manages multiple sales channels including Coupang and Naver Smartstore.

### Business Context
- **Primary Platform**: Medusa.js-based online mall (AlmondYoung)
- **Multi-channel Strategy**: Unified product management across various Korean e-commerce platforms
- **Core Purpose**: Centralized product information management with channel-specific optimizations

### Microservices Architecture
- **Main application**: `apps/almondyoung-server` - Base NestJS application
- **PIM service**: `apps/pim` - Product Information Management microservice (primary application)
- **WMS service**: `apps/wms` - Warehouse Management System microservice
- **Shared libraries**: `libs/` containing common modules

## Common Commands

### Development
```bash
# Install dependencies
npm install

# Start development server (watch mode)
npm run start:dev

# Start specific application
nest start pim --watch
```

### Build & Production
```bash
# Build all applications
npm run build

# Start production
npm run start:prod
```

### Code Quality
```bash
# Lint code
npm run lint

# Format code
npm run format

# Run all tests
npm run test

# Run specific app tests
npm run test:e2e

# Test with coverage
npm run test:cov
```

### Database (PIM Service)
```bash
# Generate database migrations
npm run db:generate:pim

# Run migrations
npm run db:migrate:pim

# Push schema to database
npm run db:push:pim
```

## Architecture

### Monorepo Structure
- Uses NestJS CLI monorepo with libraries prefixed as `@app/*`
- TypeScript path mapping configured for imports: `@app/db`, `@app/events`, `@app/shared`
- Each microservice is independent but shares common libraries

### Database Architecture
- **ORM**: Drizzle ORM with PostgreSQL
- **Schema**: Centralized schema definition per service (e.g., `apps/pim/src/schema.ts`)
- **Migrations**: Service-specific migration directories (e.g., `apps/pim/drizzle/`)
- **Connection**: Uses connection strings (DATABASE_URL) for Neon/PostgreSQL compatibility

### Event-Driven Communication
- **Transport**: Kafka via NestJS microservices
- **Pattern**: Event publisher/consumer with type-safe event definitions
- **Configuration**: Each service configures events through `EventsModule.forRoot()`

### Shared Libraries

#### `@app/db`
- Database connection management via `DbService`
- Schema-agnostic database module
- Usage: `DbModule.forRoot({ config, schema })`

#### `@app/events`
- Kafka-based event publishing system
- Type-safe event definitions
- Usage: `EventsModule.forRoot({ kafka, events })`

#### `@app/shared`
- Common DTOs, pipes, and utilities
- Zod validation pipes
- Shared event definitions

### PIM Service Specifics
The PIM (Product Information Management) service is the core of the e-commerce system, managing all product information with sophisticated multi-channel capabilities:

#### Core Entities
- **Product Categories**: Hierarchical category tree with SEO-optimized paths (`/electronics/smartphones`)
- **Product Masters**: Central product definitions with brand, description, base pricing, and SEO metadata
- **Product Option Groups/Values**: Flexible option system (colors, sizes, etc.) with display names
- **Product Variants**: SKU-level products generated from option combinations
- **Sales Channels**: Multi-platform distribution (Medusa.js, Coupang, Naver Smartstore)
- **Channel Products**: Platform-specific product optimizations

#### Pricing Strategies
- **Option-based**: Base price + option surcharges (e.g., +5,000원 for size L)
- **Variant-based**: Individual pricing per SKU variant (e.g., Red/L = 55,000원)

#### Key Features
- Centralized product information management
- Multi-channel product distribution with platform-specific optimizations
- Flexible pricing strategies supporting complex Korean e-commerce requirements
- SEO-optimized category structures and product metadata
- Real-time price calculation and preview functionality

## Development Guidelines

### Creating New Services
Use NestJS CLI: `nest generate app [service-name]` or `nest generate library [lib-name]` (as specified in `.cursor/rules/nestjs-msa.mdc`)

### Database Schema Changes (PIM Service)
1. Modify schema in `apps/pim/src/schema.ts`
2. Generate migration: `npm run db:generate:pim`
3. Review and apply: `npm run db:migrate:pim`
4. Push to development DB: `npm run db:push:pim`

### PIM Service Development Patterns
- **Price Strategy Pattern**: Use factory pattern for pricing strategies (`apps/pim/src/services/pricing/`)
- **DTO Validation**: Use Zod schemas in `apps/pim/src/schemas/` for request validation
- **Type Safety**: TypeScript types in `apps/pim/src/types/` for response DTOs
- **Business Logic**: Services in `apps/pim/src/services/` handle domain logic
- **API Layer**: Controllers in `apps/pim/src/controllers/` handle HTTP requests

### Code Style
- ESLint with TypeScript rules configured
- Prettier for formatting
- TypeScript strict mode with some relaxed rules for `any` types
- Korean comments acceptable for business domain concepts

### Testing
- Jest for unit tests
- E2E tests in service-specific directories (`apps/pim/test/`)
- Integration tests for database operations and pricing strategies

### API Documentation
Refer to `apps/pim/docs/pim-comprehensive-guide.md` for complete API endpoints and business logic understanding.