#!/usr/bin/env bash
# 컷오버 리허설 전후로 로컬 DB 를 떠 두고 되돌린다 (#1251).
#
# 리허설은 로컬 DB 를 «컷오버 이후» 로 만든다 — core(sync·init·재고 이동·드레인 닫기), medusa(예약 정리·출고 수량),
# channel_adapter(예약 투영 T). 되돌리지 않으면 다른 로컬 작업 전에 bootstrap 으로 통째로 새로 해야 한다.
# wallet 도 뜬다 — 리허설 주문(order:place:local)은 wallet 포인트로 결제한다. 빼면 되돌린 뒤 core·medusa 엔 없는 주문의
# 결제·포인트 차감이 wallet 에만 남는다(11-19 첫 리허설에서 그렇게 7건이 남았다). 주문 경로가 닿는 DB 가 늘면 여기에 더한다.
# 이름을 그대로 두고 내용만 되돌리므로 앱 .env·TENANT_LIST 는 건드리지 않는다.
#
#   bash scripts/local/sellmate-rehearsal/snapshot.sh save      # 리허설 전. 스택이 내려가 있어야 한다(템플릿 복사는 연결 0 필요)
#   bash scripts/local/sellmate-rehearsal/snapshot.sh restore   # 리허설 뒤. 스택을 내린 뒤. 스냅샷은 남긴다(다시 리허설 가능)
#   bash scripts/local/sellmate-rehearsal/snapshot.sh drop      # 스냅샷 지우기
#   bash scripts/local/sellmate-rehearsal/snapshot.sh status
#
# restore 는 Kafka 소비 그룹 오프셋도 끝으로 민다 — 리허설 중 나가고 아직 안 읽힌 이벤트가 되돌린 DB 로 들어오지 않게.
# Redis(Medusa 캐시)는 비운다 — 리허설 값이 캐시에 남아 화면이 되돌린 DB 와 어긋나지 않게.
set -euo pipefail

PG=almondyoung-server-postgres-1
KAFKA=almondyoung-server-kafka-1
REDIS=almondyoung-server-redis-1
DBS=(dev_core medusa channel_adapter user_service wallet)
SUFFIX=_pre_cutover_rehearsal

psql_() { docker exec "$PG" psql -U postgres -v ON_ERROR_STOP=1 -Atc "$1"; }
exists() { [ "$(psql_ "select 1 from pg_database where datname = '$1'")" = "1" ]; }
connections() { psql_ "select count(*) from pg_stat_activity where datname = '$1' and pid <> pg_backend_pid()"; }

require_no_connections() {
  local busy=""
  for db in "$@"; do
    local n; n=$(connections "$db")
    [ "$n" = "0" ] || busy+=" $db($n)"
  done
  if [ -n "$busy" ]; then
    echo "✗ 연결이 남아 있다:$busy — 스택(start:all:local)을 내린 뒤 다시" >&2
    exit 1
  fi
}

case "${1:-}" in
  save)
    require_no_connections "${DBS[@]}"
    for db in "${DBS[@]}"; do
      if exists "$db$SUFFIX"; then echo "✗ $db$SUFFIX 가 이미 있다 — 되돌리려면 restore, 새로 뜨려면 drop 먼저" >&2; exit 1; fi
    done
    for db in "${DBS[@]}"; do
      psql_ "create database \"$db$SUFFIX\" template \"$db\"" >/dev/null
      echo "✓ $db → $db$SUFFIX"
    done
    ;;
  restore)
    for db in "${DBS[@]}"; do
      exists "$db$SUFFIX" || { echo "✗ 스냅샷 $db$SUFFIX 가 없다 — save 를 안 했다" >&2; exit 1; }
    done
    require_no_connections "${DBS[@]}"
    for db in "${DBS[@]}"; do
      psql_ "drop database \"$db\"" >/dev/null
      psql_ "create database \"$db\" template \"$db$SUFFIX\"" >/dev/null
      echo "✓ $db ← $db$SUFFIX"
    done
    for g in $(docker exec "$KAFKA" kafka-consumer-groups --bootstrap-server localhost:9092 --list 2>/dev/null); do
      docker exec "$KAFKA" kafka-consumer-groups --bootstrap-server localhost:9092 --group "$g" \
        --reset-offsets --to-latest --all-topics --execute >/dev/null
      echo "✓ Kafka 소비 그룹 $g → 끝"
    done
    docker exec "$REDIS" redis-cli FLUSHALL >/dev/null && echo "✓ Redis 비움"
    echo "되돌렸다. 스냅샷은 남겼다(다시 리허설하려면 그대로 restore, 다 끝났으면 drop)."
    ;;
  drop)
    for db in "${DBS[@]}"; do
      if exists "$db$SUFFIX"; then psql_ "drop database \"$db$SUFFIX\"" >/dev/null; echo "✓ $db$SUFFIX 지움"; fi
    done
    ;;
  status)
    for db in "${DBS[@]}"; do
      printf '%-18s 연결 %s · 스냅샷 %s\n' "$db" "$(connections "$db")" "$(exists "$db$SUFFIX" && echo 있음 || echo 없음)"
    done
    ;;
  *)
    echo "사용: snapshot.sh save | restore | drop | status" >&2
    exit 2
    ;;
esac
