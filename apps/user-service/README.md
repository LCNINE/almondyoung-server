
```
# 데이터베이스 마이그레이션 후
npm run db:migrate  # (있다면)
npm run seed        # 초기 데이터 삽입
```

```
# 데이터베이스 리셋 후
npm run seed        # 테스트 데이터 다시 생성
```

```
# 프로젝트 클론 후(새로운 개발자 온보딩 시)
npm install
npm run seed        # 기본 데이터 설정
```