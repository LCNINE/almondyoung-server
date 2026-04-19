#!/bin/bash
# Redpanda EC2 bootstrap: EBS 포맷/마운트 + Docker 설치 + Redpanda systemd 유닛.
# 첫 부팅 시 cloud-init이 실행. 인스턴스 재기동 시에는 systemd + fstab이 자동 복구.
# __REDPANDA_ADVERTISE_DNS__는 배포 시 Cloud Map DNS 이름으로 치환됨.
set -euxo pipefail

# ─── EBS 마운트 ───
# Nitro 인스턴스에선 추가 EBS가 /dev/nvme1n1로 노출됨 (root는 nvme0).
DEV=/dev/nvme1n1
for i in $(seq 1 60); do [ -e "$DEV" ] && break; sleep 1; done
if ! blkid "$DEV" >/dev/null 2>&1; then
  mkfs.xfs -L redpanda "$DEV"
fi
mkdir -p /var/lib/redpanda/data
grep -q "LABEL=redpanda" /etc/fstab || echo "LABEL=redpanda /var/lib/redpanda/data xfs defaults,nofail 0 2" >> /etc/fstab
mount -a
# Redpanda 컨테이너 uid/gid = 101
chown -R 101:101 /var/lib/redpanda/data

# ─── Docker ───
dnf install -y docker
systemctl enable --now docker

# ─── Redpanda systemd 유닛 ───
cat > /etc/systemd/system/redpanda.service <<'UNIT'
[Unit]
Description=Redpanda
After=docker.service var-lib-redpanda-data.mount
Requires=docker.service

[Service]
Restart=always
RestartSec=5
ExecStartPre=-/usr/bin/docker rm -f redpanda
ExecStart=/usr/bin/docker run --rm --name redpanda \
  --network host \
  -v /var/lib/redpanda/data:/var/lib/redpanda/data \
  redpandadata/redpanda:latest \
  redpanda start --overprovisioned --smp 1 --memory 700M --reserve-memory 0M \
  --node-id 0 --check=false \
  --kafka-addr PLAINTEXT://0.0.0.0:9092 \
  --advertise-kafka-addr PLAINTEXT://__REDPANDA_ADVERTISE_DNS__:9092

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now redpanda
