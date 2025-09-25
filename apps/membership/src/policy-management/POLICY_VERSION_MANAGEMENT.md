# 정책 버전 관리 시스템

## 개요

정책 관리 시스템에 버전 관리 기능이 추가되어 정책 변경 이력을 추적하고 이전 버전으로 롤백할 수 있습니다.

## 주요 기능

### 1. 정책 버전 생성
- `createPolicyVersion(policyId, changes)`: 기존 정책의 새 버전을 생성
- 기존 정책을 비활성화하고 새 버전을 활성화
- 트랜잭션을 통한 데이터 일관성 보장

### 2. 버전 조회
- `getPolicyVersions(policyId)`: 정책의 모든 버전을 조회
- 최신 버전부터 순서대로 정렬 (버전 1이 최신)

### 3. 버전 비교
- `comparePolicyVersions(policyId, version1, version2)`: 두 버전 간 차이점 분석
- 필드별 변경사항을 상세히 제공

### 4. 롤백 기능
- `rollbackToVersion(policyId, targetVersion)`: 특정 버전으로 롤백
- 트랜잭션을 통한 안전한 롤백 처리

### 5. 변경 이력
- `getPolicyChangeHistory(policyId)`: 정책 변경 이력을 시간순으로 조회

## 타입 정의

```typescript
interface PolicyVersion {
  id: string;
  version: number;
  ruleValue: Record<string, any>;
  changeReason?: string;  // 향후 구현 예정
  changedBy?: string;     // 향후 구현 예정
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface PolicyVersionComparison {
  policyId: string;
  version1: PolicyVersion;
  version2: PolicyVersion;
  differences: Array<{
    field: string;
    oldValue: any;
    newValue: any;
  }>;
}
```

## 사용 예시

```typescript
// 새 버전 생성
const newVersion = await policyService.createPolicyVersion('policy-id', {
  ruleValue: { maxPauses: 3 },
  changeReason: '정책 완화',
  changedBy: 'admin-user-id'
});

// 버전 비교
const comparison = await policyService.comparePolicyVersions('policy-id', 1, 2);

// 롤백
const rolledBack = await policyService.rollbackToVersion('policy-id', 2);
```

## 제한사항

- 현재 DB 스키마에는 `changeReason`, `changedBy` 필드가 없어 향후 마이그레이션 필요
- 버전 번호는 생성 시간 기준으로 자동 할당 (최신이 1번)
- 삭제된 정책의 버전 관리는 지원하지 않음

## 향후 개선사항

1. 정책 변경 승인 워크플로우 추가
2. 변경 사유 및 변경자 정보 저장을 위한 스키마 확장
3. 버전별 성능 영향 분석 기능
4. 자동 백업 및 복구 기능