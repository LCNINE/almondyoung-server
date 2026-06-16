FROM grafana/alloy:latest

COPY deployments/lcnine/services/observability/alloy/config.alloy /etc/alloy/config.alloy

EXPOSE 4317 4318 12345

CMD ["run", "--server.http.listen-addr=0.0.0.0:12345", "/etc/alloy/config.alloy"]
