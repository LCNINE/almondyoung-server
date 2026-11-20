-- 런북 §3 1번: collect-cellmate 가 넘긴 가장 큰 주문번호 {{N}} 앞뒤 자사몰 주문의 생성 시각. medusa DB, 읽기 전용(sql.ts).
-- 판정: display_id <= {{N}} 은 전부 created_at < T, > {{N}} 은 전부 >= T.
select display_id, created_at, created_at at time zone 'Asia/Seoul' as created_at_kst
  from "order"
 where display_id between {{N}} - 3 and {{N}} + 5
 order by display_id;
