# Cellmate Order Collection Tools

These shared operational scripts collect live Medusa orders for Cellmate and synchronize shipped status to Medusa and Core.

- `collect-cellmate.js`: reads live Medusa orders and writes Cellmate CSV/XLSX/JSON.
- `mark-medusa-shipped.js`: sets physical Medusa order-item shipped quantities.
- `mark-core-shipped.js`: maps Medusa display IDs to Core and marks sales/fulfillment rows shipped.

Run from `deployments/lcnine/services` inside `npx sst shell --stage live`, with the DB tunnel on `127.0.0.1:15432`:

```bash
NODE_PATH=/home/hyunji/문서/GitHub/almondyoung-server/apps/medusa/node_modules:/home/hyunji/문서/GitHub/almondyoung-server/node_modules \
DB_TUNNEL_HOST=127.0.0.1 DB_TUNNEL_PORT=15432 \
LATEST_DISPLAY_ID=<last> AWAITING_IDS=<comma-separated> INCLUDE_ALL_AWAITING=1 \
EXCLUDE_DISPLAY_IDS=<comma-separated IDs already uploaded separately> \
OUTPUT_PREFIX=cellmate-after-<last>-with-confirmed-YYYYMMDD \
OUTPUT_DIR=/home/hyunji/문서/GitHub/almondyoung-server/apps/medusa \
npx sst shell --stage live -- node ../../../scripts/ops/cellmate-local/collect-cellmate.js
```

The two shipped scripts receive `DISPLAY_IDS=...` in the same SST shell. Keep the latest handoff values in the conversation, not in this directory.
