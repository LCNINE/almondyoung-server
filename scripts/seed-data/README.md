# Almondyoung Server - Integrated Seed Data Script

This directory contains an integrated seed data script that populates all microservice databases with initial data for development and testing environments.

## Features

- **Unified Execution**: Seeds all microservices (WMS, PIM, User Service, Membership, Wallet, File Service, Notification) in a single run
- **Idempotent**: Uses fixed UUIDs (UUIDv7 format) and `ON CONFLICT DO NOTHING` to allow safe re-runs
- **Self-Contained**: Uses its own `.env` file, independent of application configurations
- **Graceful Error Handling**: Can continue execution even if one service fails (configurable)
- **Detailed Reporting**: Provides comprehensive execution report with success/failure status and timings

## Directory Structure

```
scripts/seed-data/
├── .env.example                # Environment variable template
├── .env                         # Actual environment variables (gitignored)
├── .gitignore
├── package.json                 # Script dependencies
├── tsconfig.json                # TypeScript configuration
├── constants/
│   └── uuids.ts                 # Fixed UUID constants (UUIDv7)
├── shared/
│   ├── types.ts                 # Shared type definitions
│   └── logger.ts                # Logging utility
├── seeders/
│   ├── 01-wms.seeder.ts         # WMS seed data
│   ├── 02-pim.seeder.ts         # PIM seed data
│   ├── 03-user-service.seeder.ts # User Service seed data
│   ├── 04-membership.seeder.ts  # Membership seed data
│   ├── 05-wallet.seeder.ts      # Wallet seed data (empty)
│   ├── 06-file-service.seeder.ts # File Service seed data
│   └── 07-notification.seeder.ts # Notification seed data
└── index.ts                     # Main execution script
```

## Setup

### 1. Install Dependencies

```bash
cd scripts/seed-data
npm install
```

### 2. Configure Environment

Copy the example environment file and edit with your database credentials:

```bash
cp .env.example .env
# Edit .env with your database URLs and secrets
```

### Required Environment Variables

```bash
# Database URLs (Required)
WMS_DATABASE_URL=postgresql://user:password@localhost:5432/wms_db
PIM_DATABASE_URL=postgresql://user:password@localhost:5432/pim_db
USER_SERVICE_DATABASE_URL=postgresql://user:password@localhost:5432/user_service_db
MEMBERSHIP_DATABASE_URL=postgresql://user:password@localhost:5432/membership_db
WALLET_DATABASE_URL=postgresql://user:password@localhost:5432/wallet_db
FILE_SERVICE_DATABASE_URL=postgresql://user:password@localhost:5432/file_service_db
NOTIFICATION_DATABASE_URL=postgresql://user:password@localhost:5432/notification_db

# File Service Template DB (Optional - skips if not provided)
FILE_TEMPLATE_DB_URL=postgresql://user:password@localhost:5432/file_template_db

# Admin Initial Password (Required)
ADMIN_INITIAL_PASSWORD=Admin@1234!

# Notification Provider Secrets (Required for Notification Service)
NOTIFICATION_FCM_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
NOTIFICATION_RESEND_API_KEY=your_resend_api_key
NOTIFICATION_TWILIO_AUTH_TOKEN=your_twilio_auth_token
NOTIFICATION_TWILIO_ACCOUNT_SID=your_twilio_account_sid
NOTIFICATION_NHN_APP_KEY=your_nhn_app_key
NOTIFICATION_NHN_SECRET_KEY=your_nhn_secret_key
NOTIFICATION_NHN_SENDER_KEY=your_nhn_sender_key

# Execution Options (Optional)
SEED_CONTINUE_ON_ERROR=true      # Continue even if one seeder fails
SEED_VERBOSE=true                # Print detailed logs
```

## Usage

Run the seed script from this directory:

```bash
npm run seed
```

Or using ts-node directly:

```bash
ts-node index.ts
```

## Seed Data Details

### WMS (Warehouse Management System)

- **2 Warehouses**: 부천 물류창고 (domestic), 중국 물류창고 (overseas)
- **8 System Locations**: 4 per warehouse (receiving, shipping, damage, return zones)
- **4 Settings**: 2 per warehouse (use_sub_barcode, use_expiry_separation)

### PIM (Product Information Management)

- **1 Sales Channel**: 아몬드영 자사몰 (Medusa)

### User Service

- **2 Roles**: admin, membership
- **12 Scopes**: master, user:*, admin:* (based on `packages/auth-constants/scopes.ts`)
- **1 Admin User**:
  - Login ID: `admin`
  - Email: `admin@almondyoung.com`
  - Password: From `ADMIN_INITIAL_PASSWORD` env var
- **Role-Scope Mappings**:
  - admin role: All 12 scopes
  - membership role: user:read, user:modify only

### Membership

- **1 Tier**: MEMBERSHIP (priority level 1)
- **2 Plans**:
  - 30 days: ₩4,990
  - 365 days: ₩49,900
- **5 Cancellation Reasons**: Not using, Expensive, Lack of benefits, Using other service, Other

### Wallet

- No seed data (empty by design)

### File Service

- **file_contexts**: Copied from template database (if `FILE_TEMPLATE_DB_URL` is provided)
- Gracefully skips if template DB URL is not configured

### Notification

- **4 Notification Providers**:
  - FCM Push
  - Resend Email
  - Twilio SMS
  - NHN KakaoTalk
- Sensitive configuration extracted to environment variables

## Idempotency

All seed operations use:

1. **Fixed UUIDs**: Predefined in `constants/uuids.ts` (UUIDv7 format for timestamp-based sorting)
2. **Conflict Handling**: `ON CONFLICT DO NOTHING` for safe re-runs
3. **Unique Constraints**: Leverages database unique constraints to prevent duplicates

You can safely run this script multiple times without creating duplicate data.

## Error Handling

- **SEED_CONTINUE_ON_ERROR=true** (default): Continues execution even if one seeder fails
- **SEED_CONTINUE_ON_ERROR=false**: Stops immediately on first error

Each seeder runs in its own transaction and failure is isolated.

## Execution Report

After completion, you'll see a detailed report:

```
============================================================
                    SEED REPORT
============================================================

✓ WMS                      SUCCESS              1234ms
✓ PIM                      SUCCESS              567ms
✓ User Service             SUCCESS              890ms
✓ Membership               SUCCESS              456ms
✓ Wallet                   SUCCESS              12ms
✓ File Service             SUCCESS              234ms
✓ Notification             SUCCESS              678ms

------------------------------------------------------------
Summary: 7 succeeded, 0 failed (100.0%)
Total Duration: 4071ms (4.07s)
============================================================
```

## Troubleshooting

### "Missing required environment variables"

Make sure your `.env` file has all required database URLs set.

### Connection Errors

- Verify database servers are running
- Check database URLs format: `postgresql://user:password@host:port/database`
- Ensure databases exist (create them if needed)

### Migration Errors

Make sure all database migrations are up to date before running seed scripts:

```bash
# From project root
npm run db:push.wms
npm run db:push:pim
# ... etc for each service
```

### File Service Skipped

If you see "FILE_TEMPLATE_DB_URL not provided, skipping", this is normal if you don't have a template database. The file service seeder will complete successfully without copying data.

## Development

To modify seed data:

1. Edit the appropriate seeder file in `seeders/`
2. If adding new fixed UUIDs, update `constants/uuids.ts`
3. Test by running `npm run seed`

## Security Notes

- **Never commit `.env` file** - it contains sensitive credentials
- **Rotate passwords** - change `ADMIN_INITIAL_PASSWORD` for production environments
- **Protect API keys** - notification provider secrets should be kept secure
- This seed script is intended for **development/testing only**, not production

## License

Internal use only - Almondyoung Server
