DO $$
DECLARE
  duplicate_reversal RECORD;
BEGIN
  SELECT reversal_of_event_id, count(*) AS duplicate_count
    INTO duplicate_reversal
    FROM stock_events
   WHERE reversal_of_event_id IS NOT NULL
   GROUP BY reversal_of_event_id
  HAVING count(*) > 1
   ORDER BY reversal_of_event_id
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = format(
        'Cannot create uq_stock_events_reversal_of_event: reversal_of_event_id %s is referenced by %s stock events',
        duplicate_reversal.reversal_of_event_id,
        duplicate_reversal.duplicate_count
      ),
      DETAIL = 'Existing duplicate reversal evidence must be investigated before this migration can continue.',
      HINT = 'Inspect stock_events for the reported reversal_of_event_id, repair the corrupted history explicitly, then rerun the migration. This migration never deletes or rewrites stock events.';
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_stock_events_reversal_of_event" ON "stock_events" USING btree ("reversal_of_event_id") WHERE "stock_events"."reversal_of_event_id" IS NOT NULL;
