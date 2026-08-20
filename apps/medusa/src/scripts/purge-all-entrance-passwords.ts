/**
 * 일회성: Medusa 의 **주문·카트** metadata 에 남아 있는 모든 공동현관 비번을 나이와 무관하게
 * 파기한다.
 *
 * 평시 파기는 스케줄 잡(`jobs/purge-expired-entrance-passwords.ts`, 생성일 +14일)이 한다.
 * 이 스크립트는 그 잡이 생기기 전에 쌓인 잔류분을 한 번에 털기 위한 것이다 — 그래서 보관 상한을
 * 무시하고 전량을 지운다.
 *
 * 카트를 함께 터는 이유: 체크아웃은 비번을 `cart.metadata` 에 먼저 쓰고 `complete-cart` 가
 * 그걸 주문으로 복사한다. 주문만 지우면 같은 값이 카트 행에 그대로 남는다.
 *
 * ⚠️ **되돌릴 수 없다.** 실행 전 두 가지를 확인할 것:
 *   1. core 가 비번을 받기 시작한 배포가 끝났는가. 순서를 어기면 미배송 주문의 비번이 어디에도
 *      없게 된다.
 *   2. dry run 이 보여주는 "상한 내" 건수. 그건 core 가 아직 못 받았을 수 있는(= 배포 이전에
 *      만들어진) 최근 주문을 포함한다. 그 위험을 피하고 싶으면 이 스크립트를 돌리지 말고
 *      스케줄 잡이 14일에 걸쳐 자연히 털게 두면 된다.
 *      (카트 쪽은 core 로 넘어가는 경로가 아니라 순수 잔여물이므로 이 위험이 없다.)
 *
 * 실행 방법:
 *   # 1) 건수만 본다 (기본값, 아무 것도 지우지 않는다)
 *   npx medusa exec ./src/scripts/purge-all-entrance-passwords.ts
 *
 *   # 2) 실제로 파기한다
 *   npx medusa exec ./src/scripts/purge-all-entrance-passwords.ts --confirm=purge-all-entrance-passwords
 */
import type { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import {
  ENTRANCE_PASSWORD_CANDIDATE_SQL,
  ENTRANCE_PASSWORD_CART_CANDIDATE_SQL,
  ENTRANCE_PASSWORD_CART_COUNT_SQL,
  ENTRANCE_PASSWORD_COUNT_SQL,
  ENTRANCE_PASSWORD_TTL_DAYS,
  type EntrancePasswordCandidate,
  PURGE_ALL_CONFIRM_TOKEN,
  buildEntrancePasswordPurgeUpdates,
  chunk,
  entrancePasswordCutoff,
  parseEntrancePasswordPurgeArgs,
} from './lib/entrance-password-purge';

const PAGE_SIZE = 500;
const UPDATE_CHUNK = 50;

/**
 * 페이지 루프의 안전장치.
 *
 * 루프는 "후보 조회 → 파기 → 재조회"라 파기가 반영되면 후보가 줄어 자연히 끝난다. 반영되지
 * 않으면 같은 페이지를 영원히 돈다 — 그때는 조용히 도는 대신 터지게 한다.
 */
const MAX_PAGES = 200;

/** 파기 대상 한 종류(주문/카트)의 조회·갱신 방법. 두 종류가 **같은 규칙**을 쓰게 묶는다. */
type PurgeTarget = {
  label: string;
  countSql: string;
  candidateSql: string;
  update: (ids: string[]) => Promise<unknown>;
};

type PurgeCounts = { total: number; expired: number; withinTtl: number };

async function countTarget(
  knex: { raw: (sql: string, bindings: unknown[]) => Promise<{ rows?: { total?: number; expired?: number }[] }> },
  target: PurgeTarget,
  cutoff: Date,
): Promise<PurgeCounts> {
  const result = await knex.raw(target.countSql, [cutoff.toISOString()]);
  const row = result.rows?.[0] ?? {};
  const total = row.total ?? 0;
  const expired = row.expired ?? 0;
  return { total, expired, withinTtl: total - expired };
}

export default async function purgeAllEntrancePasswords({ container, args }: ExecArgs) {
  const { dryRun } = parseEntrancePasswordPurgeArgs(args ?? []);
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const orderModule = container.resolve(Modules.ORDER);
  const cartModule = container.resolve(Modules.CART);

  const targets: PurgeTarget[] = [
    {
      label: '주문',
      countSql: ENTRANCE_PASSWORD_COUNT_SQL,
      candidateSql: ENTRANCE_PASSWORD_CANDIDATE_SQL,
      update: (ids) => orderModule.updateOrders(buildEntrancePasswordPurgeUpdates(ids)),
    },
    {
      label: '카트',
      countSql: ENTRANCE_PASSWORD_CART_COUNT_SQL,
      candidateSql: ENTRANCE_PASSWORD_CART_CANDIDATE_SQL,
      update: (ids) => cartModule.updateCarts(buildEntrancePasswordPurgeUpdates(ids)),
    },
  ];

  const cutoff = entrancePasswordCutoff(new Date());
  const [orderCounts, cartCounts] = await Promise.all(targets.map((target) => countTarget(knex, target, cutoff)));

  for (const [index, target] of targets.entries()) {
    const counts = index === 0 ? orderCounts : cartCounts;
    logger.info(
      `[entrance-password-purge] 비번 보유 ${target.label} ${counts.total}건 ` +
        `(보관 상한 ${ENTRANCE_PASSWORD_TTL_DAYS}일 초과 ${counts.expired}건, 상한 내 ${counts.withinTtl}건)`,
    );
  }

  if (dryRun) {
    logger.info(
      '[entrance-password-purge] DRY RUN — 아무 것도 지우지 않았다. ' +
        `실제 파기는 --confirm=${PURGE_ALL_CONFIRM_TOKEN} 를 붙일 것 ` +
        `(나이와 무관하게 주문 ${orderCounts.total}건 · 카트 ${cartCounts.total}건 전량 삭제, 복구 불가).`,
    );
    return {
      dryRun: true,
      orders: { ...orderCounts, purged: 0 },
      carts: { ...cartCounts, purged: 0 },
    };
  }

  const purgeTarget = async (target: PurgeTarget, counts: PurgeCounts) => {
    if (counts.total === 0) {
      logger.info(`[entrance-password-purge] ${target.label} 파기 대상 없음. 작업 불필요.`);
      return { ...counts, purged: 0, remaining: 0 };
    }

    let purged = 0;
    for (let page = 0; ; page += 1) {
      if (page >= MAX_PAGES) {
        throw new Error(
          `[entrance-password-purge] ${target.label} 처리가 ${MAX_PAGES} 페이지를 넘겼다 — ` +
            `파기가 반영되지 않는 것 같다. 지금까지 ${purged}건 처리. 중단한다.`,
        );
      }

      const result = await knex.raw(target.candidateSql, [PAGE_SIZE]);
      const candidates: EntrancePasswordCandidate[] = result.rows ?? [];
      if (candidates.length === 0) {
        break;
      }

      const ids = candidates.map((candidate) => candidate.id);
      for (const idChunk of chunk(ids, UPDATE_CHUNK)) {
        await target.update(idChunk);
      }
      purged += ids.length;
      logger.info(`[entrance-password-purge] ${target.label} ${purged}/${counts.total}건 파기…`);
    }

    // 남은 건수를 다시 세서 0 을 확인한다 — "지웠다"는 주장 대신 술어로 확인한다.
    const verify = await countTarget(knex, target, cutoff);
    if (verify.total > 0) {
      logger.warn(
        `[entrance-password-purge] ${target.label} 완료했으나 ${verify.total}건이 남아 있다 — 다시 실행할 것.`,
      );
    } else {
      logger.info(`[entrance-password-purge] ${target.label} 완료 — ${purged}건 파기, 잔여 0건.`);
    }

    return { ...counts, purged, remaining: verify.total };
  };

  // 순차로 돈다 — 두 루프가 같은 커넥션을 나눠 쓰면 페이지 재조회가 서로를 가린다.
  const orders = await purgeTarget(targets[0], orderCounts);
  const carts = await purgeTarget(targets[1], cartCounts);

  return { dryRun: false, orders, carts };
}
