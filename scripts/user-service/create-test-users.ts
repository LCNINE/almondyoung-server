import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import { drizzle, type PostgresJsDatabase, type PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import * as bcrypt from 'bcrypt';
import * as schema from '../../apps/user-service/database/drizzle/schema';

type ConsentInput = Partial<{
  isOver14: boolean;
  termsOfService: boolean;
  electronicTransaction: boolean;
  privacyPolicy: boolean;
  thirdPartySharing: boolean;
  marketingConsent: boolean;
}>;

type TestUserInput = {
  email?: string;
  loginId?: string;
  username?: string;
  nickname?: string;
  password?: string;
  phoneNumber?: string;
  birthDate?: string;
  roleName?: string;
  roleId?: string;
  isEmailVerified?: boolean;
  verifyPhone?: boolean;
  consents?: ConsentInput;
};

type NormalizedUser = {
  email: string;
  loginId: string;
  username: string;
  nickname: string;
  password: string;
  phoneNumber: string;
  birthDate: string;
  roleName: string;
  roleId?: string;
  isEmailVerified: boolean;
  verifyPhone: boolean;
  consents: ConsentInput;
};

type UsersFile =
  | TestUserInput[]
  | {
    defaults?: TestUserInput;
    users: TestUserInput[];
  };

type CliOptions = {
  file?: string;
  count: number;
  prefix: string;
  emailDomain: string;
  email?: string;
  loginId?: string;
  username?: string;
  nickname?: string;
  password: string;
  roleName: string;
  roleId?: string;
  phoneNumber?: string;
  birthDate?: string;
  verifyPhone: boolean;
  isEmailVerified: boolean;
  envPath: string;
};

type DbClient =
  | PostgresJsDatabase<Record<string, unknown>>
  | PostgresJsTransaction<any, any>;

const DEFAULT_CONSENTS = {
  isOver14: true,
  termsOfService: true,
  electronicTransaction: true,
  privacyPolicy: true,
  thirdPartySharing: false,
  marketingConsent: false,
};

const DEFAULTS: CliOptions = {
  count: 1,
  prefix: 'testuser',
  emailDomain: 'example.com',
  password: 'Test@1234',
  roleName: 'membership',
  verifyPhone: false,
  isEmailVerified: true,
  envPath: path.join(process.cwd(), 'apps', 'user-service', '.env'),
};

function printHelp(): void {
  console.log(`
Create test users for user-service (DB direct).

Usage:
  ts-node -r tsconfig-paths/register scripts/user-service/create-test-users.ts [options]

Options:
  --file <path>            JSON file with users array (or { defaults, users })
  --count <n>              Number of users to generate (default: 1)
  --prefix <text>          LoginId/email prefix for generated users (default: testuser)
  --email-domain <domain>  Email domain for generated users (default: example.com)
  --email <value>          Email for a single user
  --login-id <value>       Login ID for a single user
  --username <value>       Username for a single user
  --nickname <value>       Nickname for a single user
  --password <value>       Password for generated users (default: Test@1234)
  --role <name>            Role name to assign (default: membership)
  --role-id <uuid>         Role ID to assign (overrides --role)
  --phone <number>         Phone number for all generated users
  --birth-date <date>      Birth date (YYYYMMDD or YYYY-MM-DD) for all generated users
  --verify-phone           Insert phone verification rows (requires phone)
  --unverified             Set isEmailVerified=false
  --env <path>             Path to env file (default: apps/user-service/.env)
  --help                   Show this help

Examples:
  ts-node -r tsconfig-paths/register scripts/user-service/create-test-users.ts --count 3 --prefix qauser
  ts-node -r tsconfig-paths/register scripts/user-service/create-test-users.ts --file scripts/user-service/test-users.json
`);
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const countValue = options.count ? Number(options.count) : DEFAULTS.count;
  if (!Number.isFinite(countValue) || countValue < 1) {
    throw new Error('`--count` must be a positive number.');
  }

  return {
    file: options.file ? String(options.file) : undefined,
    count: countValue,
    prefix: options.prefix ? String(options.prefix) : DEFAULTS.prefix,
    emailDomain: options['email-domain']
      ? String(options['email-domain'])
      : DEFAULTS.emailDomain,
    email: options.email ? String(options.email) : undefined,
    loginId: options['login-id'] ? String(options['login-id']) : undefined,
    username: options.username ? String(options.username) : undefined,
    nickname: options.nickname ? String(options.nickname) : undefined,
    password: options.password ? String(options.password) : DEFAULTS.password,
    roleName: options.role ? String(options.role) : DEFAULTS.roleName,
    roleId: options['role-id'] ? String(options['role-id']) : undefined,
    phoneNumber: options.phone ? String(options.phone) : undefined,
    birthDate: options['birth-date'] ? String(options['birth-date']) : undefined,
    verifyPhone: Boolean(options['verify-phone']),
    isEmailVerified: !options.unverified,
    envPath: options.env ? String(options.env) : DEFAULTS.envPath,
  };
}

function loadUsersFromFile(filePath: string): {
  defaults: TestUserInput;
  users: TestUserInput[];
} {
  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(content) as UsersFile;

  if (Array.isArray(parsed)) {
    return { defaults: {}, users: parsed };
  }

  if (!parsed.users || !Array.isArray(parsed.users)) {
    throw new Error('Invalid file format. Expected array or { defaults, users }.');
  }

  return {
    defaults: parsed.defaults ?? {},
    users: parsed.users,
  };
}

function buildGeneratedPhoneNumber(index: number): string {
  const suffix = String(index + 1).padStart(8, '0');
  return `010${suffix}`;
}

function buildGeneratedBirthDate(): string {
  return '1990-01-01';
}

function parseBirthDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d{8}$/.test(trimmed)) {
    const year = Number(trimmed.slice(0, 4));
    const month = Number(trimmed.slice(4, 6));
    const day = Number(trimmed.slice(6, 8));
    return new Date(year, month - 1, day);
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid birthDate: ${value}`);
  }
  return date;
}

function normalizeUser(
  input: TestUserInput,
  index: number,
  cli: CliOptions,
  defaults: TestUserInput,
): NormalizedUser {
  const merged: TestUserInput = {
    ...defaults,
    ...input,
  };

  const seq = String(index + 1).padStart(3, '0');
  const prefix = cli.prefix;

  const loginId = (merged.loginId || cli.loginId || `${prefix}${seq}`).toLowerCase();
  const email = merged.email || cli.email || `${prefix}${seq}@${cli.emailDomain}`;
  const username = merged.username || cli.username || `user${seq}`;
  const nickname = merged.nickname || cli.nickname || `user${seq}`;
  const password = merged.password || cli.password;
  const phoneNumber =
    merged.phoneNumber ?? cli.phoneNumber ?? buildGeneratedPhoneNumber(index);
  const birthDate =
    merged.birthDate ?? cli.birthDate ?? buildGeneratedBirthDate();
  const roleName = merged.roleName ?? cli.roleName;
  const roleId = merged.roleId ?? cli.roleId;
  const isEmailVerified =
    typeof merged.isEmailVerified === 'boolean'
      ? merged.isEmailVerified
      : cli.isEmailVerified;
  const verifyPhone =
    typeof merged.verifyPhone === 'boolean' ? merged.verifyPhone : cli.verifyPhone;
  const consents = {
    ...DEFAULT_CONSENTS,
    ...(merged.consents ?? {}),
  };

  if (!/^[a-z0-9]+$/.test(loginId)) {
    throw new Error(`Invalid loginId: ${loginId}. Use lowercase letters/numbers only.`);
  }
  if (loginId.length < 4 || loginId.length > 20) {
    throw new Error(`Invalid loginId length: ${loginId}. Must be 4-20 chars.`);
  }
  if (email.length > 60) {
    throw new Error(`Email too long: ${email}`);
  }
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  if (verifyPhone && !phoneNumber) {
    throw new Error('`--verify-phone` requires a phone number.');
  }

  return {
    email,
    loginId,
    username,
    nickname,
    password,
    phoneNumber,
    birthDate,
    roleName,
    roleId,
    isEmailVerified,
    verifyPhone,
    consents,
  };
}

async function resolveRoleId(
  db: DbClient,
  roleName: string,
  cache: Map<string, string>,
): Promise<string> {
  const cached = cache.get(roleName);
  if (cached) return cached;

  const [role] = await db
    .select({ roleId: schema.roles.roleId })
    .from(schema.roles)
    .where(eq(schema.roles.name, roleName))
    .limit(1);

  if (!role) {
    throw new Error(`Role not found: ${roleName}`);
  }

  cache.set(roleName, role.roleId);
  return role.roleId;
}

async function upsertUser(
  db: DbClient,
  input: NormalizedUser,
  hashedPassword: string,
): Promise<{ userId: string; existed: boolean }> {
  const existingByEmail = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      loginId: schema.users.loginId,
    })
    .from(schema.users)
    .where(eq(schema.users.email, input.email))
    .limit(1)
    .then((rows) => rows[0]);

  const existingByLoginId = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      loginId: schema.users.loginId,
    })
    .from(schema.users)
    .where(eq(schema.users.loginId, input.loginId))
    .limit(1)
    .then((rows) => rows[0]);

  if (
    existingByEmail &&
    existingByLoginId &&
    existingByEmail.id !== existingByLoginId.id
  ) {
    throw new Error(
      `Email ${input.email} and loginId ${input.loginId} belong to different users.`,
    );
  }

  const existing = existingByEmail ?? existingByLoginId;

  if (existing) {
    await db
      .update(schema.users)
      .set({
        email: input.email,
        loginId: input.loginId,
        username: input.username,
        nickname: input.nickname,
        password: hashedPassword,
        isEmailVerified: input.isEmailVerified,
        deletedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, existing.id));

    return { userId: existing.id, existed: true };
  }

  const [created] = await db
    .insert(schema.users)
    .values({
      email: input.email,
      loginId: input.loginId,
      username: input.username,
      nickname: input.nickname,
      password: hashedPassword,
      isEmailVerified: input.isEmailVerified,
    })
    .returning({ id: schema.users.id });

  if (!created) {
    throw new Error('Failed to insert user.');
  }

  return { userId: created.id, existed: false };
}

async function upsertProfile(
  db: DbClient,
  userId: string,
  input: NormalizedUser,
): Promise<void> {
  const birthDate = parseBirthDate(input.birthDate);
  const profileValues: typeof schema.profiles.$inferInsert = {
    userId,
    phoneNumber: input.phoneNumber,
    birthDate,
  };

  await db
    .insert(schema.profiles)
    .values(profileValues)
    .onConflictDoUpdate({
      target: schema.profiles.userId,
      set: {
        phoneNumber: input.phoneNumber,
        birthDate,
        updatedAt: new Date(),
      },
    });
}

async function upsertConsents(
  db: DbClient,
  userId: string,
  consents: ConsentInput,
): Promise<void> {
  const now = new Date();
  await db
    .insert(schema.userConsents)
    .values({
      userId,
      ...consents,
      consentedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.userConsents.userId,
      set: {
        ...consents,
        consentedAt: now,
        updatedAt: now,
      },
    });
}

async function assignRole(
  db: DbClient,
  userId: string,
  roleId: string,
): Promise<void> {
  await db
    .insert(schema.userRoleAssignments)
    .values({ userId, roleId })
    .onConflictDoNothing();
}

async function insertPhoneVerification(
  db: DbClient,
  phoneNumber: string,
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  await db.insert(schema.phoneVerifications).values({
    phoneNumber,
    code: '000000',
    purpose: 'phone_verify',
    isVerified: true,
    verifiedAt: now,
    isExpired: false,
    attempts: 0,
    maxAttempts: 3,
    expiresAt,
  });
}

async function main() {
  const cli = parseArgs();

  if (cli.envPath) {
    config({ path: cli.envPath });
  }

  const databaseUrl =
    process.env.DATABASE_URL || process.env.USER_SERVICE_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is missing. Set it in apps/user-service/.env or pass via environment.',
    );
  }

  const { users, defaults } = cli.file
    ? loadUsersFromFile(cli.file)
    : {
      defaults: {},
      users: Array.from({ length: cli.count }, () => ({})),
    };

  const singleUserFields = [cli.email, cli.loginId, cli.username, cli.nickname].filter(
    (value) => value && String(value).length > 0,
  );

  if (!cli.file && cli.count > 1 && singleUserFields.length > 0) {
    throw new Error(
      'When using --count > 1, do not pass --email/--login-id/--username/--nickname. Use --file or run per user.',
    );
  }

  const client = postgres(databaseUrl);
  const db = drizzle(client);

  const roleCache = new Map<string, string>();
  const results: Array<{ userId: string; loginId: string; email: string; existed: boolean }> = [];

  try {
    await db.transaction(async (tx) => {
      for (let index = 0; index < users.length; index += 1) {
        const normalized = normalizeUser(users[index], index, cli, defaults);

        const hashedPassword = await bcrypt.hash(normalized.password, 10);
        const { userId, existed } = await upsertUser(tx, normalized, hashedPassword);

        await upsertProfile(tx, userId, normalized);
        await upsertConsents(tx, userId, normalized.consents ?? DEFAULT_CONSENTS);

        const roleId = normalized.roleId
          ? normalized.roleId
          : await resolveRoleId(tx, normalized.roleName, roleCache);
        await assignRole(tx, userId, roleId);

        if (normalized.verifyPhone) {
          await insertPhoneVerification(tx, normalized.phoneNumber);
        }

        results.push({
          userId,
          loginId: normalized.loginId,
          email: normalized.email,
          existed,
        });
      }
    });
  } finally {
    await client.end();
  }

  console.log('\n✅ Test user creation complete\n');
  for (const result of results) {
    const status = result.existed ? 'updated' : 'created';
    console.log(`- ${status}: ${result.loginId} (${result.email}) -> ${result.userId}`);
  }
  console.log('');
}

main().catch((error) => {
  console.error('❌ Failed to create test users');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
