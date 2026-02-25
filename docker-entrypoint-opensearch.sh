#!/bin/bash
chown -R 1000:1000 /usr/share/opensearch/data 2>/dev/null || true
exec gosu 1000 /usr/share/opensearch/opensearch-docker-entrypoint.sh "$@"
