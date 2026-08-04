# 로컬 개발용 OpenSearch. 라이브(Railway)와 같은 2.18.0 을 쓴다 — 인덱스 settings 가
# 버전별 analyzer 스펙에 걸리므로 버전이 어긋나면 로컬에서만 인덱스 생성이 깨진다.
#
# analysis-nori 는 필수다. products 인덱스 settings 가 nori_tokenizer /
# nori_part_of_speech 를 요구해서, 플러그인이 없으면 인덱스 생성 자체가 실패한다.
FROM opensearchproject/opensearch:2.18.0

RUN /usr/share/opensearch/bin/opensearch-plugin install --batch analysis-nori
