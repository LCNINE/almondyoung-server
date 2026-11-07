DELETE FROM "product_master_pricing_rules" m USING "pricing_rules" r WHERE m."pricing_rule_id" = r."id" AND r."layer" = 'tiered_price';--> statement-breakpoint
DELETE FROM "pricing_rules" WHERE "layer" = 'tiered_price';
