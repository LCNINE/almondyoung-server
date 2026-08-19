// wallet-web 판. storefront 원본은 브라우저에서 /api/medusa 프록시를 타지만, wallet-web 의
// 체크아웃은 Medusa 호출을 전부 서버사이드로만 한다 — 자격증명이 httpOnly 쿠키에 있고,
// 그 덕에 Medusa STORE_CORS 에 wallet-web 을 추가할 필요도 없다.
export { medusa as sdk } from "@/lib/medusa"
