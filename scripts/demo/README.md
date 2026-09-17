# Demo catalog snapshot and import

These tools copy catalog reference data from the live Core database into the demo Core database. They never copy
stock, reservations, orders, customers, purchase orders, receipts, work logs, or demand history. Snapshot export
runs in a PostgreSQL `REPEATABLE READ READ ONLY` transaction. Import defaults to a dry run and writes only after
`--apply`.

Do not put a database URL on the command line or commit a snapshot/report. Supply URLs through the environment and
write artifacts to an access-controlled directory outside the repository. The tools never serialize credentials.

## Safety bindings

The source check requires all of the following:

- `--source-stage live`;
- a read-only transaction reported by PostgreSQL;
- exact `current_database()`, `host(inet_server_addr())`, and `inet_server_port()` values matching the three
  `--expect-source-*` arguments.

The server host is the database server's current private IP, not an SSH tunnel endpoint. Resolve/re-audit it before
each session because an RDS failover can change it.

The target check is independent of application environment variables. It requires:

- `--target-stage demo` and `--external-integrations-mode mock`;
- exact server-side database/private-IP/port values matching `--expect-target-*`;
- exact tunnel or direct endpoint host/port matching `--expect-target-connected-*` and the target URL;
- the known demo holder, demo mock delivery profile, demo warehouse, and demo storage location markers.

Any mismatch stops before metadata DDL or catalog writes.

## Export

Run an aggregate check first. This reads the complete allowlisted scope but does not create a file:

```bash
CATALOG_SOURCE_DATABASE_URL="$LIVE_CORE_URL" corepack yarn tsx scripts/demo/catalog-snapshot.ts \
  --source-stage live \
  --expect-source-database "$LIVE_DATABASE" \
  --expect-source-host "$LIVE_SERVER_PRIVATE_IP" \
  --expect-source-port 5432 \
  --check
```

Export once the identity and aggregate counts are reviewed:

```bash
CATALOG_SOURCE_DATABASE_URL="$LIVE_CORE_URL" corepack yarn tsx scripts/demo/catalog-snapshot.ts \
  --source-stage live \
  --expect-source-database "$LIVE_DATABASE" \
  --expect-source-host "$LIVE_SERVER_PRIVATE_IP" \
  --expect-source-port 5432 \
  --export \
  --out "$SECURE_DIR/catalog-snapshot.json"
```

Timestamp columns are exported as PostgreSQL text, preserving naive wall-clock values and microsecond precision.
Source creation timestamps are refreshed on matching catalog IDs as part of the source reference data.

Export uses exclusive file creation and refuses to overwrite an existing artifact. Console output contains counts
and hashes, not connection strings or full row data.

## Dry run and import

Dry run is the default. The connected host must exactly match the hostname spelling in
`CATALOG_TARGET_DATABASE_URL` (`127.0.0.1` and `localhost` are intentionally different bindings).

```bash
CATALOG_TARGET_DATABASE_URL="$DEMO_CORE_URL" corepack yarn tsx scripts/demo/catalog-import.ts \
  --snapshot "$SECURE_DIR/catalog-snapshot.json" \
  --target-stage demo \
  --external-integrations-mode mock \
  --expect-target-database "$DEMO_DATABASE" \
  --expect-target-host "$DEMO_SERVER_PRIVATE_IP" \
  --expect-target-port 5432 \
  --expect-target-connected-host "$DEMO_TUNNEL_HOST" \
  --expect-target-connected-port "$DEMO_TUNNEL_PORT" \
  --check
```

For the full live artifact, allow enough Node heap for JSON parsing and fallback planning by prefixing the import
command with `NODE_OPTIONS=--max-old-space-size=4096`.

The dry run validates hashes, exact SKU IDs, relationships, target identity, unique-key collisions, existing demo
coverage, and the deterministic fallback plan. It creates no table and changes no row.

Apply with the same bindings and snapshot. A report path is optional and also refuses to overwrite an existing
file:

```bash
CATALOG_TARGET_DATABASE_URL="$DEMO_CORE_URL" corepack yarn tsx scripts/demo/catalog-import.ts \
  --snapshot "$SECURE_DIR/catalog-snapshot.json" \
  --report "$SECURE_DIR/catalog-import-report.json" \
  --target-stage demo \
  --external-integrations-mode mock \
  --expect-target-database "$DEMO_DATABASE" \
  --expect-target-host "$DEMO_SERVER_PRIVATE_IP" \
  --expect-target-port 5432 \
  --expect-target-connected-host "$DEMO_TUNNEL_HOST" \
  --expect-target-connected-port "$DEMO_TUNNEL_PORT" \
  --apply
```

Writes are set-based batches of 1,000 rows in one serializable transaction. Running the same snapshot again updates
the same catalog IDs and metadata row. A snapshot older than the latest source extraction is rejected. For a newer
snapshot, only relationship keys recorded by the previous import are removed when absent; unrelated demo-created
relationships remain untouched. Deferred parent columns are restored including explicit `NULL` values.

## Data boundary and mapping

The canonical allowlist is `CATALOG_TABLES` in `catalog-policy.ts`. It includes:

- SKU IDs/codes/names, deletion state, physical attributes, MOQ, category/group membership, image references;
- barcode IDs/values, primary state, and integer packing units;
- supplier IDs/names/codes, purchase settings, SKU relationships, aggregate lead-time profiles and supplier rules;
- PIM masters/versions/variants, categories/options, price rules/cache, purchase constraints and image references;
- resolved/unresolved product matchings and set-component quantities.

It explicitly excludes supplier contacts, addresses, registration and bank details, freeform supplier/SKU memos,
staff/manager/actor IDs, approval comments, channel configuration/credentials, and all customer/transaction/work
tables. Unknown tables or columns in an artifact fail validation.

Source SKU IDs and deletion flags remain unchanged. Source supplier IDs remain unchanged, but their default
warehouse maps to the demo domestic warehouse. Every imported physical SKU maps to the demo holder, mock delivery
profile, and storage location. Non-physical SKUs do not receive warehouse shipping mappings.

A physical SKU is usable only when a real matching reaches a resolved `matched` active variant through a
nondeleted active `physical` product version. Real PIM, matching, and set links are always retained. When no usable
path exists, the importer adds a deterministic demo-only master/version/variant/matching link for that SKU; source
deletion state determines whether the fallback is inactive. Stable SHA-256-derived UUIDs make this idempotent.

If a later snapshot provides a usable real path, the prior demo fallback version and variant become inactive while
the link remains for audit. This also handles a SKU changing from physical to nonphysical.

Every nondeleted physical source SKU without a source supplier relationship receives a relationship to the demo
domestic supplier. A pre-existing target supplier relationship suppresses that fallback. Import metadata records
the exact fallback SKU IDs, and a later real source relationship removes only the previously tracked demo fallback.
Synthetic catalog versions use a training supply price of 10,000; source prices remain unchanged.

Product/SKU image reference IDs and non-null variant `image_id` references are copied, but this tool does not copy
file-service blobs or permissions. The report records the number of references that still require demo file-service
access validation.

## Copy referenced public product images

`catalog-image-copy.ts` copies only file-service objects referenced by `product_images.file_id` on active,
nondeleted, physical product versions. Historical, deleted, and nonphysical product-version references remain
excluded and are counted by reason in the report. The live Core and FileService reads use PostgreSQL
`REPEATABLE READ READ ONLY` transactions.

The source upload row must already be active, public, nondeleted, and stored in S3. The bounded allowlist is:

- `product-image`: `products/images/`, up to 10 MiB, JPEG/PNG/WebP plus existing public GIF rows;
- `product-description-image`: `products/description-image/`, up to 20 MiB, JPEG/PNG.

The legacy GIF allowance applies only to copying existing active public rows; it does not change either
`file_contexts` upload policy. The command checks both source and target context rows for active, public-only
settings and their exact prefix and size limit. Private, deleted, pending, unrelated-context, non-S3, invalid-size,
and unsafe-path rows are never copied or activated.

Put the Core and FileService connection documents in a `0600` directory. The first has the existing
`live`/`demo` Core connection shape. The second has `live`/`demo` objects with `url`, `publicBucket`, and
`privateBucket`. The command refuses a shared live/demo public bucket, mismatched connected endpoints, unexpected
database identities, or a reused report path.

Run the read-only check first:

```bash
corepack yarn tsx scripts/demo/catalog-image-copy.ts \
  --connections "$SECURE_DIR/connections.json" \
  --file-connections "$SECURE_DIR/file-connections.json" \
  --report "$SECURE_DIR/catalog-image-check.json" \
  --aws-region ap-northeast-2 \
  --max-files 40000 \
  --concurrency 8 \
  --expect-live-core-database "$LIVE_CORE_DATABASE" \
  --expect-live-file-database "$LIVE_FILE_DATABASE" \
  --expect-demo-file-database "$DEMO_FILE_DATABASE" \
  --expect-live-server-host "$LIVE_SERVER_PRIVATE_IP" \
  --expect-demo-server-host "$DEMO_SERVER_PRIVATE_IP" \
  --expect-server-port 5432 \
  --check
```

After reviewing the exact coverage and plan hash, run the same command with a new report path and `--apply`.
Applying requires source-public S3 Get/Head access, target-public Head/Copy access, live database read access, and
demo FileService database write access. The target bucket policy supplies public read access; the copy request does
not send an object ACL, so it works with S3 Bucket owner enforced object ownership. Objects are copied before their allowlisted upload
rows are inserted. Existing matching objects and rows are reused; different content or row data stops the run.
Every copied row keeps its source ID and technical metadata but replaces `uploaded_by` with the demo fixture actor.
The command is replay-safe for a matching completed or partially completed run.

## Manifest and audit

The snapshot manifest contains source server identity, extraction time, schema version, per-table counts, the exact
sorted source SKU ID set, its SHA-256 digest, and a content digest. After a successful import, the tool creates the
demo-owned `demo_catalog_imports` table and upserts one row keyed by the content digest. That row stores source and
target server identities, source counts, exact source/imported SKU ID arrays, hashes, fallback links, and the import
report. A successful apply is committed only when no source SKU ID is missing and every deletion flag matches.

Nullable source references whose parent row is already missing are set to `NULL` only in the snapshot. The manifest
stores the table/column/parent, exact affected row and referenced IDs, count, and digest. No replacement PIM object
is fabricated.

## Prepare a focused practice scenario

Catalog import creates reference data only. It does not bulk-create stock or work. Save a focused request before
preparing a training exercise so the same UUID can be replayed safely after an uncertain network result:

```json
{
  "requestId": "00000000-0000-4000-8000-000000000001",
  "items": [{ "skuId": "00000000-0000-4000-8000-000000000002", "quantity": 10 }],
  "prepareDemand": true
}
```

The CLI defaults to a nonmutating validation check:

```bash
APP_STAGE=demo EXTERNAL_INTEGRATIONS_MODE=mock \
corepack yarn tsx scripts/demo/prepare-practice.ts --request "$SECURE_DIR/practice-request.json"
```

Apply with the same request. The token is read from the environment, and the optional result is created exclusively
with mode `0600`:

```bash
APP_STAGE=demo EXTERNAL_INTEGRATIONS_MODE=mock DEMO_ADMIN_ACCESS_TOKEN="$DEMO_ADMIN_ACCESS_TOKEN" \
corepack yarn tsx scripts/demo/prepare-practice.ts \
  --request "$SECURE_DIR/practice-request.json" \
  --out "$SECURE_DIR/practice-result.json" \
  --apply
```

The endpoint performs the actual receipt and putaway plus the optional demand profile in one transaction. Use it
for representative practice SKUs and later replenishment exercises rather than loading stock for the full catalog.

## Tests

Unit tests:

```bash
corepack yarn jest --runInBand \
  scripts/demo/catalog-policy.spec.ts \
  scripts/demo/catalog-snapshot.spec.ts \
  scripts/demo/catalog-import.spec.ts \
  scripts/demo/catalog-image-copy.spec.ts
```

The PostgreSQL integration test requires two separately migrated, disposable databases named exactly
`demo_training_import_source` and `demo_training_import_target`:

```bash
DEMO_CATALOG_SOURCE_TEST_URL="$LOCAL_IMPORT_SOURCE_URL" \
DEMO_CATALOG_TARGET_TEST_URL="$LOCAL_IMPORT_TARGET_URL" \
corepack yarn jest --runInBand scripts/demo/catalog-import.integration.spec.ts
```

It exports an allowlisted source snapshot, performs dry run, imports twice, and verifies exact SKU/deletion
coverage, barcode packing units, real set quantities, deterministic fallback state, metadata ID sets, and unchanged
pre-existing stock and movement work rows.
