와우프레스 상수(`WOWPRESS_PRODUCTS`)의 variant 매핑을 `print_product_specs` 에 옮긴다. 이미 있는 행은 건드리지 않는다.
로컬: `npx dotenv -e apps/core/.env -- tsx scripts/ops/print-product-specs/migrate-constant-specs.ts --stage local --dry-run` (`--dry-run` 을 빼면 삽입)
라이브: `deployments/lcnine/services` 에서 `npx sst shell --stage live -- npx tsx ../../../scripts/ops/print-product-specs/migrate-constant-specs.ts --stage live [--tenant <slug>] [--dry-run]`
