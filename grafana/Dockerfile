FROM grafana/grafana:latest
COPY provisioning /etc/grafana/provisioning
ENV GF_SECURITY_ADMIN_PASSWORD=admin
ENV GF_USERS_ALLOW_SIGN_UP=false
ENV GF_SERVER_HTTP_PORT=3000
EXPOSE 3000
