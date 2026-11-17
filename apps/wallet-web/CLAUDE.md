# CLAUDE.md — wallet-web

**디자인의 정본(SoT)은 스토어프론트 [`DESIGN.md`](../../web/almondyoung-storefront/DESIGN.md) 다.** UI 를 만들거나 고치기 전에 그 문서를 읽고 따른다. 이 앱에 따로 디자인 문서를 만들지 않는다.

- 색 토큰은 `app/globals.css` 에 스토어프론트와 같은 값으로 둔다. 스토어프론트 토큰이 바뀌면 여기도 같이 바꾼다.
- 색은 라이브(develop) `globals.css` 값 그대로 둔다. 강조·진행 막대·체크·링크는 모두 `primary`(주황)를 쓴다.
- `npx shadcn init` 이나 테마 프리셋으로 `globals.css` 를 덮어쓰지 않는다. 라이브 색이 기본값으로 바뀐다.
