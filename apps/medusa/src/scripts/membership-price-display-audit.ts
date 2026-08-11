import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import type { ExecArgs } from '@medusajs/framework/types';

const MEMBERSHIP_PRICE_LIST_TITLE = 'Membership Prices';

// 대량 불일치는 개별 상품 실수가 아니라 price_list 가 통째로 날아간 사고 신호다
// (2026-06 에 27,001건 유실 전례). 그때는 metadata 쪽이 오히려 유일한 원본이므로
// 이 잡은 절대 자동 교정하지 않는다 — 교정하면 복구 근거까지 덮어쓴다.
const MASS_INCIDENT_THRESHOLD = 100;

const AUDIT_SQL = `
  select
    p.handle,
    p.title,
    pv.id as variant_id,
    (pv.metadata->>'membershipPrice')::numeric as displayed,
    coalesce(pl.amount, b.amount) as expected
  from product_variant pv
  join product p on p.id = pv.product_id and p.deleted_at is null
  join lateral (
    select pr.amount
    from price pr
    join product_variant_price_set pvps on pvps.price_set_id = pr.price_set_id
    where pvps.variant_id = pv.id and pr.price_list_id is null and pr.deleted_at is null
    limit 1
  ) b on true
  left join lateral (
    select pr.amount
    from price pr
    join product_variant_price_set pvps on pvps.price_set_id = pr.price_set_id
    join price_list l on l.id = pr.price_list_id
    where pvps.variant_id = pv.id and pr.deleted_at is null and l.title = ?
    limit 1
  ) pl on true
  where pv.deleted_at is null
    and p.status = 'published'
    and pv.metadata->>'membershipPrice' ~ '^[0-9.]+$'
    and abs((pv.metadata->>'membershipPrice')::numeric - coalesce(pl.amount, b.amount)) > 0.5
  order by (coalesce(pl.amount, b.amount) - (pv.metadata->>'membershipPrice')::numeric) desc
`;

type AuditRow = {
  handle: string;
  title: string;
  variant_id: string;
  displayed: string;
  expected: string;
};

export default async function membershipPriceDisplayAudit({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);

  const result = await knex.raw(AUDIT_SQL, [MEMBERSHIP_PRICE_LIST_TITLE]);
  const rows: AuditRow[] = result.rows ?? [];

  if (rows.length === 0) {
    logger.info('[membership-price-audit] 표시가와 실제 멤버십 결제가 불일치 없음');
    return { mismatches: 0, rows: [] };
  }

  // 표시가가 결제가보다 싼 건 고객이 본 값보다 더 내는 상황이라 CS 로 직결된다.
  const overcharging = rows.filter((r) => Number(r.displayed) < Number(r.expected));

  const level = rows.length >= MASS_INCIDENT_THRESHOLD ? 'error' : 'warn';
  logger[level](
    `[membership-price-audit] 멤버십 표시가 불일치 ${rows.length}건` +
      (overcharging.length > 0 ? ` (표시보다 비싸게 결제되는 건 ${overcharging.length}건)` : '') +
      (rows.length >= MASS_INCIDENT_THRESHOLD
        ? ' — 대량 불일치. price_list 유실 사고를 의심할 것. metadata 를 덮어쓰지 말 것.'
        : '')
  );

  for (const r of rows.slice(0, 20)) {
    logger[level](
      `[membership-price-audit]   표시 ${Number(r.displayed).toLocaleString()} / 결제 ${Number(
        r.expected
      ).toLocaleString()}  ${r.title}  (handle=${r.handle})`
    );
  }
  if (rows.length > 20) {
    logger[level](`[membership-price-audit]   … 외 ${rows.length - 20}건`);
  }

  return { mismatches: rows.length, rows };
}
