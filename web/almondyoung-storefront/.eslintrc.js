const restrictedPatterns = [
  {
    group: ["@/lib/data/*"],
    message: "server-only 비즈니스 계층입니다.",
  },
]

// `unstable_cache` 는 인자와 함수 소스만 캐시 키에 넣고 클로저로 잡은 변수는 넣지 않는다.
// 요청마다 달라지는 값(방문자 세그먼트 등)을 클로저로 잡으면 첫 방문자의 응답이 그 키에 굳어
// 다른 사람에게 나간다. 눈으로 잡기 어려운 종류라 호출을 한 파일에 가둔다.
const restrictedPaths = [
  {
    name: "next/cache",
    importNames: ["unstable_cache"],
    message:
      "unstable_cache 는 src/lib/data/catalog-cache.ts 에서만 부른다 (캐시 키에 안 들어가는 클로저 값 방지).",
  },
]

module.exports = {
  extends: ["next/core-web-vitals"],
  rules: {
    "no-restricted-imports": [
      "error",
      { patterns: restrictedPatterns, paths: restrictedPaths },
    ],
  },
  overrides: [
    {
      files: ["src/lib/data/catalog-cache.ts"],
      rules: {
        "no-restricted-imports": ["error", { patterns: restrictedPatterns }],
      },
    },
  ],
}
