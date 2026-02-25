#!/bin/bash
# Volume이 root 소유로 마운트될 수 있으므로 런타임에 권한 수정
chown -R 1000:1000 /usr/share/opensearch/data 2>/dev/null || true

exec su-exec opensearch /usr/share/opensearch/opensearch-docker-entrypoint.sh "$@"
