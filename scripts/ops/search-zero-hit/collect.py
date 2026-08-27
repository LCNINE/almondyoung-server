# -*- coding: utf-8 -*-
"""검색 0건 키워드 수집 — 1단계.

OpenSearch 검색 로그에서 결과 0건 키워드를 모으고, 지금도 0건인지 실측한 뒤,
상품 인덱스와 대조해 '진짜 미취급'과 '멤버십 은닉 등 노출 결함'을 가른다.

  python3 collect.py --since 2026-06-18 --min-count 2

결과: out/collected.json
"""
import argparse, json, os, re, time, urllib.parse, urllib.request

OS_NODE = os.environ.get("OPENSEARCH_NODE", "https://opensearch-development.up.railway.app")
EVENTS = "search_query_events"
PRODUCTS = "search_products_v2"
# page=2 로 부르면 SearchService 가 검색어를 기록하지 않는다 (isFirstPage 조건).
# 실측 자체가 0건 통계를 부풀리는 것을 막는다.
SEARCH_API = "https://search.almondyoung.com/search/products?q=%s&size=1&page=2"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")


def post(index, body, ndjson=False):
    url = f"{OS_NODE}/{index}/{'_msearch' if ndjson else '_search'}"
    data = body if ndjson else json.dumps(body).encode()
    ct = "application/x-ndjson" if ndjson else "application/json"
    req = urllib.request.Request(url, data=data, headers={"Content-Type": ct})
    return json.load(urllib.request.urlopen(req, timeout=90))


def zero_hit_keywords(since, until):
    body = {
        "size": 0,
        "query": {"bool": {"filter": [
            {"term": {"result_count": 0}},
            {"range": {"searched_at": {"gte": f"{since}T00:00:00+09:00", "lt": f"{until}T00:00:00+09:00"}}},
        ]}},
        "aggs": {"kw": {"terms": {"field": "keyword_norm", "size": 5000, "order": {"_count": "desc"}},
                        "aggs": {"first": {"min": {"field": "searched_at", "format": "yyyy-MM-dd"}},
                                 "last": {"max": {"field": "searched_at", "format": "yyyy-MM-dd"}}}}},
    }
    return post(EVENTS, body)["aggregations"]["kw"]["buckets"]


def current_total(kw):
    for _ in range(3):
        try:
            d = json.load(urllib.request.urlopen(SEARCH_API % urllib.parse.quote(kw), timeout=25))
            return d["pagination"]["total"]
        except Exception:
            time.sleep(1.0)
    return -1


def index_match(keywords):
    """키워드 문자열을 실제로 담고 있는 상품 — fuzzy 가 아닌 문자열 포함."""
    out = {}
    for i in range(0, len(keywords), 40):
        chunk, lines = keywords[i:i + 40], []
        for kw in chunk:
            c = re.sub(r"\s+", "", kw).lower()
            lines.append(json.dumps({"index": PRODUCTS}))
            lines.append(json.dumps({"size": 4, "query": {"bool": {"should": [
                {"wildcard": {"name_compact": {"value": f"*{c}*"}}},
                {"wildcard": {"brand.keyword": {"value": f"*{kw}*"}}},
                {"match_phrase": {"brand": kw}},
                {"match_phrase": {"seo_keywords": kw}},
                {"match_phrase": {"tags": kw}},
            ], "minimum_should_match": 1}},
                "_source": ["name", "brand", "is_visible_to_members_only", "status"]}, ensure_ascii=False))
        r = post(PRODUCTS, ("\n".join(lines) + "\n").encode(), ndjson=True)
        for kw, resp in zip(chunk, r["responses"]):
            h = resp.get("hits", {})
            out[kw] = {
                "total": h.get("total", {}).get("value", 0),
                "items": [{"n": d["_source"].get("name"), "b": d["_source"].get("brand"),
                           "mem": d["_source"].get("is_visible_to_members_only")} for d in h.get("hits", [])],
            }
    return out


NOISE = re.compile(r"[぀-ヿ一-鿿Ѐ-ӿ؀-ۿ]")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", required=True, help="시작일 YYYY-MM-DD (KST)")
    ap.add_argument("--until", default="2100-01-01", help="종료일(미포함) YYYY-MM-DD")
    ap.add_argument("--min-count", type=int, default=2, help="이 횟수 미만 검색어는 노이즈로 제외")
    a = ap.parse_args()

    buckets = [b for b in zero_hit_keywords(a.since, a.until) if b["doc_count"] >= a.min_count]
    print(f"0건 키워드 {len(buckets)}개 (검색 {a.min_count}회 이상)")

    rows = []
    for i, b in enumerate(buckets):
        kw = b["key"]
        rows.append({"kw": kw, "cnt": b["doc_count"],
                     "first": b["first"]["value_as_string"], "last": b["last"]["value_as_string"],
                     "now": current_total(kw)})
        if (i + 1) % 100 == 0:
            print(f"  실측 {i+1}/{len(buckets)}", flush=True)
        time.sleep(0.12)

    still_zero = [r for r in rows if r["now"] == 0]
    print(f"지금도 0건: {len(still_zero)} | 그 사이 결과 생김: {len(rows) - len(still_zero)}")

    idx = index_match([r["kw"] for r in still_zero])
    for r in still_zero:
        m = idx[r["kw"]]
        r["idx"] = m["total"]
        r["idx_items"] = m["items"]

    # 인덱스에 상품이 있는데 검색이 0건 = 미취급이 아니라 노출 결함 (대개 멤버십 은닉)
    defect = [r for r in still_zero if r["idx"] > 0]
    missing = [r for r in still_zero if r["idx"] == 0 and not NOISE.search(r["kw"])]
    print(f"노출 결함: {len(defect)} | 진짜 미취급(검증 대상): {len(missing)}")

    os.makedirs(OUT, exist_ok=True)
    json.dump({"since": a.since, "until": a.until, "all": rows,
               "defect": defect, "missing": missing,
               "solved": [r for r in rows if r["now"] > 0]},
              open(f"{OUT}/collected.json", "w"), ensure_ascii=False)
    json.dump([r["kw"] for r in missing], open(f"{OUT}/queue.json", "w"), ensure_ascii=False)
    print(f"→ {OUT}/collected.json")


if __name__ == "__main__":
    main()
