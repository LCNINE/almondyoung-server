#!/usr/bin/env bash
# 라이브 설치본을 자동 업데이트 경로(S3)에 올린다. 앱은 켤 때 latest.json 을 보고 새 버전을 묻는다.
#   사용: native/warehouse-app/scripts/release-live.sh <GitHub Actions run id>
#   run 은 Warehouse Demo Windows 워크플로를 stage=live 로 돌린 것이어야 한다(서명 .sig 가 같이 나온다).
set -euo pipefail

RUN_ID="${1:?GitHub Actions run id 가 필요합니다}"
BUCKET=almondyoung-public
PREFIX=warehouse-app
BASE_URL="https://${BUCKET}.s3.ap-northeast-2.amazonaws.com/${PREFIX}"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
gh run download "$RUN_ID" -R LCNINE/almondyoung-server -D "$WORK"

EXE=$(find "$WORK" -name '*_x64-setup.exe' | head -1)
SIG="$EXE.sig"
[ -f "$EXE" ] && [ -f "$SIG" ] || { echo "설치본이나 서명(.sig)이 없습니다 — stage=live 로 빌드했는지 확인하세요"; exit 1; }

VERSION=$(basename "$EXE" | sed -E 's/.*_([0-9]+\.[0-9]+\.[0-9]+)_x64-setup\.exe/\1/')
KEY="LCNINE-Logistics_${VERSION}_x64-setup.exe"

python3 -I - "$VERSION" "$BASE_URL/$KEY" "$SIG" > "$WORK/latest.json" <<'PY'
import json, sys, datetime
version, url, sig = sys.argv[1], sys.argv[2], open(sys.argv[3]).read().strip()
print(json.dumps({
    "version": version,
    "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "platforms": {"windows-x86_64": {"signature": sig, "url": url}},
}, ensure_ascii=False, indent=2))
PY

# 설치본을 먼저 올리고 latest.json 을 나중에 — 반대면 앱이 아직 없는 파일을 받으려 한다
aws s3 cp "$EXE" "s3://${BUCKET}/${PREFIX}/${KEY}" --content-type application/octet-stream
aws s3 cp "$WORK/latest.json" "s3://${BUCKET}/${PREFIX}/latest.json" \
  --content-type application/json --cache-control "no-cache"

echo "올렸습니다: ${VERSION}"
curl -s "${BASE_URL}/latest.json" | head -5
