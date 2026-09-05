-- 로컬 postgres 컨테이너 최초 기동 시 논리 DB 생성 (docker-entrypoint-initdb.d)
-- 배포 환경의 논리 DB 구성과 동일: lcnine-services 9개 + lcnine-auth 의 user_service
CREATE DATABASE core;
-- 로컬 core 단독 개발용 (통합테스트/refresh-from-live 가 쓰는 core 와 분리)
CREATE DATABASE dev_core;
CREATE DATABASE medusa;
CREATE DATABASE wallet;
CREATE DATABASE analytics;
CREATE DATABASE channel_adapter;
CREATE DATABASE membership;
CREATE DATABASE notification;
CREATE DATABASE ugc;
CREATE DATABASE file_service;
CREATE DATABASE user_service;
-- 🔴 search 는 apps/search 의 drizzle 대상이다. 없으면 drizzle-kit 이 에러가 아니라
-- «무한 재시도» 를 해서 migrate-all.sh 가 거기서 굳고, 목록상 뒤의 user_service 가
-- 영영 마이그레이션되지 않는다 (docs/local-e2e-environment.md §2).
CREATE DATABASE search;
