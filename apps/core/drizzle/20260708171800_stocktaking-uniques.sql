-- P0-3/P2-5 dedup (light/dev data). 운영에 실 실사 데이터가 있으면 phase 분리 (spec §10 #1).
DELETE FROM "stocktaking_adjustments" a
  USING "stocktaking_adjustments" b
  WHERE a.line_id = b.line_id AND a.created_at < b.created_at;
DELETE FROM "stocktaking_lines" a
  USING "stocktaking_lines" b
  WHERE a.session_id = b.session_id
    AND a.sku_id = b.sku_id
    AND a.location_id IS NOT DISTINCT FROM b.location_id
    AND a.created_at < b.created_at
    AND NOT EXISTS (SELECT 1 FROM "stocktaking_adjustments" adj WHERE adj.line_id = a.id);
--> statement-breakpoint
ALTER TABLE "stocktaking_adjustments" ADD CONSTRAINT "uq_stocktaking_adjustment_line" UNIQUE("line_id");--> statement-breakpoint
ALTER TABLE "stocktaking_lines" ADD CONSTRAINT "uq_stocktaking_line_session_sku_location" UNIQUE NULLS NOT DISTINCT("session_id","sku_id","location_id");
