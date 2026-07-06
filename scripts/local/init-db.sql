-- 로컬 postgres 컨테이너 최초 기동 시 논리 DB 생성 (docker-entrypoint-initdb.d)
-- 배포 환경의 논리 DB 구성과 동일: lcnine-services 9개 + lcnine-auth 의 user_service
CREATE DATABASE core;
CREATE DATABASE medusa;
CREATE DATABASE wallet;
CREATE DATABASE analytics;
CREATE DATABASE channel_adapter;
CREATE DATABASE membership;
CREATE DATABASE notification;
CREATE DATABASE ugc;
CREATE DATABASE file_service;
CREATE DATABASE user_service;
