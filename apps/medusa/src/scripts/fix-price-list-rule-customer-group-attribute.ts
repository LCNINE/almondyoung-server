/**
 * price_list_rule.attribute 마이그레이션 스크립트
 *
 * 목적:
 * - 기존: customer_group_id
 * - 변경: customer.groups.id
 *
 * 실행:
 *   yarn medusa exec ./src/scripts/fix-price-list-rule-customer-group-attribute.ts
 *
 * 옵션(환경변수):
 * - DATABASE_URL: 지정 시 해당 DB로 직접 연결(pg)하여 실행
 * - PRICE_LIST_ID: 특정 price list만 변경 (미지정 시 전체)
 * - DRY_RUN=true: 변경 없이 대상 개수만 출력
 *
 * 참고:
 * - Medusa pricing context는 customer.groups.id 키를 사용해 룰 매칭합니다.
 */
import { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { Client } from 'pg';

const OLD_ATTRIBUTE = 'customer_group_id';
const NEW_ATTRIBUTE = 'customer.groups.id';

const getScriptOptions = () => ({
  databaseUrl: process.env.DATABASE_URL?.trim() || undefined,
  priceListId: process.env.PRICE_LIST_ID?.trim() || undefined,
  dryRun: process.env.DRY_RUN === 'true',
});

const maskDatabaseUrl = (databaseUrl: string) => {
  try {
    const parsed = new URL(databaseUrl);
    const user = parsed.username ? `${parsed.username}@` : '';
    return `${parsed.protocol}//${user}${parsed.host}${parsed.pathname}`;
  } catch {
    return '<invalid DATABASE_URL format>';
  }
};

const buildQueryParts = (priceListId?: string) => {
  const where: string[] = ['attribute = $1', 'deleted_at IS NULL'];
  const params: string[] = [OLD_ATTRIBUTE];

  if (priceListId) {
    params.push(priceListId);
    where.push(`price_list_id = $${params.length}`);
  }

  return { whereClause: where.join(' AND '), params };
};

async function runWithPgDirect(params: {
  logger: { info: (msg: string) => void };
  databaseUrl: string;
  priceListId?: string;
  dryRun: boolean;
}) {
  const { logger, databaseUrl, priceListId, dryRun } = params;
  const client = new Client({ connectionString: databaseUrl });
  const { whereClause, params: whereParams } = buildQueryParts(priceListId);

  await client.connect();

  try {
    logger.info(`[fix-price-list-rule] Using DATABASE_URL: ${maskDatabaseUrl(databaseUrl)}`);

    const countResult = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM price_list_rule
       WHERE ${whereClause}`,
      whereParams,
    );

    const targetCount = Number(countResult.rows[0]?.count ?? 0);

    if (targetCount === 0) {
      logger.info('[fix-price-list-rule] No rows to update. Nothing to do.');
      return;
    }

    if (dryRun) {
      logger.info(`[fix-price-list-rule] DRY_RUN enabled. ${targetCount} row(s) would be updated.`);
      return;
    }

    const updateResult = await client.query(
      `UPDATE price_list_rule
       SET attribute = $${whereParams.length + 1},
           updated_at = NOW()
       WHERE ${whereClause}`,
      [...whereParams, NEW_ATTRIBUTE],
    );

    logger.info(
      `[fix-price-list-rule] Done. Updated ${updateResult.rowCount ?? targetCount} active price_list_rule row(s).`,
    );
  } finally {
    await client.end();
  }
}

async function runWithMedusaManager(params: {
  logger: { info: (msg: string) => void };
  manager: any;
  priceListId?: string;
  dryRun: boolean;
}) {
  const { logger, manager, priceListId, dryRun } = params;

  const knex =
    typeof manager?.getKnex === 'function' ? manager.getKnex() : manager?.getDriver?.()?.getConnection?.()?.getKnex?.();

  if (!knex) {
    throw new Error('[fix-price-list-rule] Failed to resolve knex instance from manager.');
  }

  logger.info('[fix-price-list-rule] DATABASE_URL not provided. Using Medusa container DB connection.');

  const baseQuery = knex('price_list_rule')
    .where({ attribute: OLD_ATTRIBUTE })
    .whereNull('deleted_at')
    .modify((qb: any) => {
      if (priceListId) {
        qb.andWhere({ price_list_id: priceListId });
      }
    });

  const countResult = await baseQuery.clone().count('* as count').first();
  const targetCount = Number(countResult?.count ?? 0);

  if (targetCount === 0) {
    logger.info('[fix-price-list-rule] No rows to update. Nothing to do.');
    return;
  }

  if (dryRun) {
    logger.info(`[fix-price-list-rule] DRY_RUN enabled. ${targetCount} row(s) would be updated.`);
    return;
  }

  await baseQuery.update({
    attribute: NEW_ATTRIBUTE,
    updated_at: knex.fn.now(),
  });

  logger.info(`[fix-price-list-rule] Done. Updated ${targetCount} active price_list_rule row(s).`);
}

export default async function fixPriceListRuleCustomerGroupAttribute({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  const { databaseUrl, priceListId, dryRun } = getScriptOptions();

  logger.info(
    `[fix-price-list-rule] Migrating attribute '${OLD_ATTRIBUTE}' -> '${NEW_ATTRIBUTE}'` +
      (priceListId ? ` (price_list_id=${priceListId})` : ' (all price lists)') +
      (dryRun ? ' [DRY_RUN]' : ''),
  );

  if (databaseUrl) {
    await runWithPgDirect({ logger, databaseUrl, priceListId, dryRun });
    return;
  }

  const manager = container.resolve<any>(ContainerRegistrationKeys.MANAGER);
  await runWithMedusaManager({ logger, manager, priceListId, dryRun });
}
