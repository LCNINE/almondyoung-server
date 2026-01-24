import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { Logger } from '../shared/logger';
import { FIXED_UUIDS } from '../constants/uuids';

const logger = new Logger('Membership Seeder');

interface Tier {
  id: string;
  code: string;
  priorityLevel: number;
}

interface Plan {
  id: string;
  tierId: string;
  price: number;
  durationDays: number;
  currency: string;
  trialDays: number;
  isActive: boolean;
}

interface CancellationReason {
  code: string;
  displayText: string;
  category: string;
  sortOrder: number;
  isActive: boolean;
}

export async function seedMembership(databaseUrl: string): Promise<void> {
  logger.info('Starting Membership seeding');

  const sql = postgres(databaseUrl);
  const db = drizzle(sql);

  try {
    // Step 1: Insert Tier
    logger.step(1, 3, 'Inserting membership tier');

    const tier: Tier = {
      id: FIXED_UUIDS.TIER_MEMBERSHIP,
      code: 'MEMBERSHIP',
      priorityLevel: 1,
    };

    await db.execute(sql`
      INSERT INTO tiers (id, code, priority_level)
      VALUES (${tier.id}, ${tier.code}, ${tier.priorityLevel})
      ON CONFLICT (id) DO NOTHING
    `);

    logger.success('Inserted membership tier');

    // Step 2: Insert Plans
    logger.step(2, 3, 'Inserting membership plans');

    const plans: Plan[] = [
      {
        id: FIXED_UUIDS.PLAN_30DAYS,
        tierId: FIXED_UUIDS.TIER_MEMBERSHIP,
        price: 4990,
        durationDays: 30,
        currency: 'KRW',
        trialDays: 0,
        isActive: true,
      },
      {
        id: FIXED_UUIDS.PLAN_365DAYS,
        tierId: FIXED_UUIDS.TIER_MEMBERSHIP,
        price: 49900,
        durationDays: 365,
        currency: 'KRW',
        trialDays: 0,
        isActive: true,
      },
    ];

    for (const plan of plans) {
      await db.execute(sql`
        INSERT INTO plan (
          id, tier_id, price, duration_days, currency, trial_days, is_active
        )
        VALUES (
          ${plan.id},
          ${plan.tierId},
          ${plan.price},
          ${plan.durationDays},
          ${plan.currency},
          ${plan.trialDays},
          ${plan.isActive}
        )
        ON CONFLICT (id) DO NOTHING
      `);
    }

    logger.success(`Inserted ${plans.length} plans`);

    // Step 3: Insert Cancellation Reasons
    logger.step(3, 3, 'Inserting cancellation reasons');

    const cancellationReasons: CancellationReason[] = [
      {
        code: 'NOT_USING',
        displayText: '사용하지 않음',
        category: 'USER_CHOICE',
        sortOrder: 1,
        isActive: true,
      },
      {
        code: 'EXPENSIVE',
        displayText: '가격 부담',
        category: 'PRICE',
        sortOrder: 2,
        isActive: true,
      },
      {
        code: 'LACK_OF_BENEFITS',
        displayText: '혜택 부족',
        category: 'BENEFITS',
        sortOrder: 3,
        isActive: true,
      },
      {
        code: 'USING_OTHER_SERVICE',
        displayText: '타사 이용',
        category: 'ALTERNATIVES',
        sortOrder: 4,
        isActive: true,
      },
      {
        code: 'OTHER',
        displayText: '기타',
        category: 'OTHER',
        sortOrder: 5,
        isActive: true,
      },
    ];

    for (const reason of cancellationReasons) {
      await db.execute(sql`
        INSERT INTO cancellation_reasons (
          code, display_text, category, sort_order, is_active
        )
        VALUES (
          ${reason.code},
          ${reason.displayText},
          ${reason.category},
          ${reason.sortOrder},
          ${reason.isActive}
        )
        ON CONFLICT (code) DO NOTHING
      `);
    }

    logger.success(`Inserted ${cancellationReasons.length} cancellation reasons`);
    logger.success('Membership seeding completed successfully');
  } catch (error) {
    logger.error('Membership seeding failed', error);
    throw error;
  } finally {
    await sql.end();
  }
}
