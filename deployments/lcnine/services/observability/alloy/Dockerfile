# 버전 핀 — `:latest` 는 배포할 때마다 업스트림 최신을 끌어와, 우리 변경이 없는데도
# 관측이 깨질 수 있다. #703 이 `discovery.dns` 와 `prometheus.relabel` 을 새로 쓰기
# 시작하면서 그 표면이 넓어졌다.
#
# v1.18.1 은 2026-08-23 기준 `:latest` 와 동일한 다이제스트
# (sha256:0f4434c92b3e6cdac38bb129b344e1790c246f7b6e2eaffcc16a5fa363240e33) 다.
# 즉 #703 이 실제로 검증한 그 이미지를 이름으로 고정한 것이고, 이 핀 자체는 배포 동작을
# 바꾸지 않는다.
#
# 올릴 때: 태그를 바꾸는 것이 곧 의도적인 업그레이드다. config.alloy 를 로드시켜 부팅 로그에
# 오류가 없는지 확인하고, 배포 후 9개 job 의 `up` 시리즈가 그대로인지 본다.
FROM grafana/alloy:v1.18.1

COPY deployments/lcnine/services/observability/alloy/config.alloy /etc/alloy/config.alloy

EXPOSE 4317 4318 12345

CMD ["run", "--server.http.listen-addr=0.0.0.0:12345", "/etc/alloy/config.alloy"]
