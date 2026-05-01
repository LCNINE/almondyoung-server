module.exports = {
  extends: ["next/core-web-vitals"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@/lib/data/*"],
            message: "server-only 비즈니스 계층입니다.",
          },
        ],
      },
    ],
  },
}
