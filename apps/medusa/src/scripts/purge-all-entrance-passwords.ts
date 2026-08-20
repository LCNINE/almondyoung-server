/**
 * 일회성: Medusa 주문 metadata 에 남아 있는 **모든** 공동현관 비번을 나이와 무관하게 파기한다.
 *
 * 평시 파기는 스케줄 잡(`jobs/purge-expired-entrance-passwords.ts`, 주문일 +14일)이 한다.
 * 이 스크립트는 그 잡이 생기기 전에 쌓인 잔류분을 한 번에 털기 위한 것이다 — 그래서 보관 상한을
 * 무시하고 전량을 지운다.
 *
 * ⚠️ **되돌릴 수 없다.** 실행 전 두 가지를 확인할 것:
 *   1. core 가 비번을 받기 시작한 배포가 끝났는가. 순서를 어기면 미배송 주문의 비번이 어디에도
 *      없게 된다.
 *   2. dry run 이 보여주는 "상한 내" 건수. 그건 core 가 아직 못 받았을 수 있는(= 배포 이전에
 *      만들어진) 최근 주문을 포함한다. 그 위험을 피하고 싶으면 이 스크립트를 돌리지 말고
 *      스케줄 잡이 14일에 걸쳐 자연히 털게 두면 된다.
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

export default async function purgeAllEntrancePasswords({ container, args }: ExecArgs) {
  const { dryRun } = parseEntrancePasswordPurgeArgs(args ?? []);
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const orderModule = container.resolve(Modules.ORDER);

  const cutoff = entrancePasswordCutoff(new Date());
  const countResult = await knex.raw(ENTRANCE_PASSWORD_COUNT_SQL, [cutoff.toISOString()]);
  const counts: { total?: number; expired?: number } = countResult.rows?.[0] ?? {};
  const total = counts.total ?? 0;
  const expired = counts.expired ?? 0;
  const withinTtl = total - expired;

  logger.info(
    `[entrance-password-purge] 비번 보유 주문 ${total}건 ` +
      `(보관 상한 ${ENTRANCE_PASSWORD_TTL_DAYS}일 초과 ${expired}건, 상한 내 ${withinTtl}건)`,
  );

  if (dryRun) {
    logger.info(
      '[entrance-password-purge] DRY RUN — 아무 것도 지우지 않았다. ' +
        `실제 파기는 --confirm=${PURGE_ALL_CONFIRM_TOKEN} 를 붙일 것 (나이와 무관하게 ${total}건 전량 삭제, 복구 불가).`,
    );
    return { dryRun: true, total, expired, withinTtl, purged: 0 };
  }

  if (total === 0) {
    logger.info('[entrance-password-purge] 파기 대상 없음. 작업 불필요.');
    return { dryRun: false, total, expired, withinTtl, purged: 0 };
  }

  let purged = 0;
  for (let page = 0; ; page += 1) {
    if (page >= MAX_PAGES) {
      throw new Error(
        `[entrance-password-purge] ${MAX_PAGES} 페이지를 넘겼다 — 파기가 반영되지 않는 것 같다. ` +
          `지금까지 ${purged}건 처리. 중단한다.`,
      );
    }

    const result = await knex.raw(ENTRANCE_PASSWORD_CANDIDATE_SQL, [PAGE_SIZE]);
    const candidates: EntrancePasswordCandidate[] = result.rows ?? [];
    if (candidates.length === 0) {
      break;
    }

    const ids = candidates.map((candidate) => candidate.id);
    for (const idChunk of chunk(ids, UPDATE_CHUNK)) {
      await orderModule.updateOrders(buildEntrancePasswordPurgeUpdates(idChunk));
    }
    purged += ids.length;
    logger.info(`[entrance-password-purge] ${purged}/${total}건 파기…`);
  }

  // 남은 건수를 다시 세서 0 을 확인한다 — "지웠다"는 주장 대신 술어로 확인한다.
  const verifyResult = await knex.raw(ENTRANCE_PASSWORD_COUNT_SQL, [cutoff.toISOString()]);
  const remaining: number = verifyResult.rows?.[0]?.total ?? 0;
  if (remaining > 0) {
    logger.warn(`[entrance-password-purge] 완료했으나 ${remaining}건이 남아 있다 — 다시 실행할 것.`);
  } else {
    logger.info(`[entrance-password-purge] 완료 — ${purged}건 파기, 잔여 0건.`);
  }

  return { dryRun: false, total, expired, withinTtl, purged, remaining };
}
