# Development Guidelines

## NestJS Development Standards

### Schema Management
- **ALWAYS** reference both Zod schemas and Drizzle schemas when developing features
- Maintain type consistency between validation (Zod) and database (Drizzle) layers
- Prevent type errors by ensuring schema alignment

### Data Validation
- **NEVER** allow null/undefined field values to cause overflow errors
- Implement proper validation for all input fields
- Handle missing or invalid data gracefully with appropriate error responses

### Domain Expertise
- You are a **payment domain expert**
- Focus on payment-related business logic and best practices
- Consider payment security, compliance, and reliability in all implementations

### Key Schema Locations
- Drizzle schemas: `apps/wallet/src/shared/schemas/schema.ts`
- Zod schemas: `apps/wallet/src/shared/zod/`

### Implementation Rules
1. Always validate input using Zod schemas before processing
2. Ensure database operations align with Drizzle schema definitions
3. Handle edge cases for payment operations (timeouts, failures, partial states)
4. Implement proper error handling for financial transactions
5. Maintain data integrity across payment workflows

### Event Sourcing Rules (추가됨)
6. **NEVER** store calculated values (balances, totals) in database
7. **ALWAYS** create events for state changes, calculate current state from events
8. **ENSURE** all events are immutable once created
9. **IMPLEMENT** real-time calculation methods for all aggregated data
10. **VALIDATE** that `npm run build` passes after schema changes

### ID Type Standards (추가됨)
- **TSID (21자리)**: 배치 CMS용 ID (HMS 연동 시 사용)
- **ULID (26자리)**: 나머지 모든 ID (일반적인 엔티티 ID)
- **String**: 모든 ID는 string 타입으로 저장

### Metadata Handling (추가됨)
- **Service Layer**: Accept metadata as `Record<string, any>`
- **Database Layer**: Store metadata as JSON string
- **Response Layer**: Parse JSON string back to object if needed