# CLAUDE.md — auth-web

**디자인의 정본(SoT)은 스토어프론트 [`DESIGN.md`](../almondyoung-storefront/DESIGN.md) 다.** UI 를 만들거나 고치기 전에 그 문서를 읽고 따른다. 이 앱에 따로 디자인 문서를 만들지 않는다.

- 색 토큰은 `app/globals.css` 에 스토어프론트와 같은 값으로 둔다. 스토어프론트 토큰이 바뀌면 여기도 같이 바꾼다.
- shadcn `components/ui/*` 는 `bg-primary`(잉크)를 읽는다. 선택·진행 표시는 가이드대로 민트 계열을 쓴다(체크·라디오 `mint-deep`, 진행 막대 `mint`).
- `npx shadcn init` 이나 테마 프리셋으로 `globals.css` 를 덮어쓰지 않는다. 리브랜딩 토큰이 기본값으로 돌아간다.
