# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use. If a label does not yet exist on the GitHub repo, create it with `gh label create <name>` before applying.

## 우선순위 라벨

열린 이슈는 넷 중 하나를 단다. 트래킹 이슈만 예외다(아래).

| 라벨 | 뜻 |
| --- | --- |
| `priority:p0` | 바로 처리해야 함 — 배포 검증이나 핵심 운영을 막는다 (예: 컷오버 첫날 작업을 막는 것) |
| `priority:p1` | 높음 — 중요한 업무 흐름이 깨졌거나 쓸 수 없다 (돈·재고 정본이 틀어지는 버그 포함) |
| `priority:p2` | 중간 — 중요하지만 조사·결정·선행 작업이 남았다 |
| `priority:p3` | 낮음 — 정리, 미뤄 둔 일, 급하지 않은 후속 |

p1 과 p2 를 가르는 질문은 «지금 깨져 있나»다. 중요해도 지금 바로 손댈 수 없으면 p2 다.

선행 작업 때문에 p2 로 둔 이슈는 그 선행이 끝나도 아무도 다시 열어 보지 않는다. 그래서 선행 쪽 트래킹 이슈에 «끝나면 이 이슈들의 우선순위를 다시 본다» 체크박스를 둔다(예: #1233 → #1346·#1306).

### 트래킹 이슈는 우선순위를 달지 않는다

일을 sub-issue 로만 하는 이슈(트래킹 이슈)에는 `tracking` 을 달고 우선순위는 달지 않는다. 우선순위는 자식들의 라벨로 읽는다.

- 「자식 중 가장 높은 것을 따른다」는 도출값이라, 자식이 닫히거나 바뀌어도 부모를 고칠 이유가 없어 갈린다. 자식이 많은 트래커는 거의 늘 가장 높은 값이 되어 필터도 흐린다.
- 자기 산출물이 있고 후속 하나쯤을 sub-issue 로 단 이슈는 트래킹 이슈가 아니다 — 우선순위를 단다.

라벨 누락 점검(트래킹 제외):

```bash
gh issue list --state open --limit 1000 --json number,title,labels \
  --jq '.[]|select([.labels[].name|startswith("priority:") or .=="tracking"]|any|not)|"#\(.number) \(.title)"'
```
