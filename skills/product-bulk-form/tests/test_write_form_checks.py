import openpyxl
import pytest

from write_form import META_SHEET, apply_changes


def _new(row_key, **over):
    base = {"상품키": row_key, "필드": {"name": "x", "basePrice": "1"}}
    base.update(over)
    return base


def test_예약_형식_상품키로_신규를_만들면_거부한다(prefilled_workbook, columns, tmp_path):
    with pytest.raises(ValueError, match="P-000123"):
        apply_changes(prefilled_workbook, {"신규": [_new("P-000123")]}, tmp_path / "o.xlsx", columns)


def test_양식정보를_잃은_프리필의_예약_상품키는_양식_재발급을_안내한다(prefilled_workbook, columns, tmp_path):
    """had_meta 는 원본 워크북 기준이다. 프리필 워크북이 숨은 _양식정보 시트를 잃은 채
    들어오면 '다른 상품키를 지어라'는 안내는 정반대 방향이다 — 그대로 따라 상품키를 바꿔
    올리면 그 키가 더 이상 예약 형식이 아니게 되어 서버의 예약 키 가드를 비껴가고, 워크북이
    '신규 전용 세션'으로 읽혀 프리필 행 전량이 신규 상품으로 대량 중복 생성된다."""
    wb = openpyxl.load_workbook(prefilled_workbook)
    del wb[META_SHEET]
    lost_meta = tmp_path / "lost_meta.xlsx"
    wb.save(lost_meta)

    with pytest.raises(ValueError) as exc_info:
        apply_changes(lost_meta, {}, tmp_path / "o.xlsx", columns)

    message = str(exc_info.value)
    assert "양식을 다시" in message
    assert "다른 상품키를 지어" not in message


def test_조합이_옵션_시트에_없는_값키를_가리키면_거부한다(prefilled_workbook, columns, tmp_path):
    with pytest.raises(ValueError, match="V99"):
        apply_changes(
            prefilled_workbook,
            {"신규": [_new("NEW-1",
                           옵션=[{"optionKey": "G1", "optionName": "색", "optionValueKey": "V9", "optionValueName": "검정"}],
                           조합=[{"조합": ["V99"]}])]},
            tmp_path / "o.xlsx", columns,
        )


def test_대표_카테고리가_둘이면_거부한다(prefilled_workbook, columns, tmp_path):
    with pytest.raises(ValueError, match="대표"):
        apply_changes(
            prefilled_workbook,
            {"신규": [_new("NEW-1", 카테고리=[
                {"categoryPath": "여성패션>니트", "isPrimary": "Y"},
                {"categoryPath": "여성패션>티셔츠", "isPrimary": "Y"},
            ])]},
            tmp_path / "o.xlsx", columns,
        )


def test_손대지_않은_상품의_대표_카테고리_이상은_경고일_뿐_막지_않는다(make_workbook, columns, tmp_path):
    """PROBE A — 대표 카테고리 0개인 레거시 상품이 프리필에 섞여 있는데 다른 상품만 고친다.

    서버가 스스로 만드는 데이터다(`categories.service.ts:858-864` 의 addProductsToCategory 는
    기존 대표 유무를 안 보고 isPrimary=false 로만 insert 한다). 워크북 전체를 막으면 이
    스크립트에는 행 삭제 기능이 없고 절대 규칙 1 이 새 워크북 생성을 금지하므로 빠져나갈
    길이 없다. 서버는 같은 조건을 그 행만 invalid 로 떨구고 세션을 진행시킨다."""
    src = make_workbook("legacy.xlsx", {
        "상품": [{"rowKey": "P-000001", "name": "티셔츠", "basePrice": "19000"},
                 {"rowKey": "P-000002", "name": "레거시", "basePrice": "9000"}],
        "카테고리": [{"rowKey": "P-000001", "categoryPath": "여성패션>티셔츠", "isPrimary": "Y"},
                     {"rowKey": "P-000002", "categoryPath": "여성패션>니트", "isPrimary": "N"}],
    })
    out = tmp_path / "o.xlsx"

    report = apply_changes(src, {"변경": [{"상품키": "P-000001", "필드": {"brand": "NEW"}}]}, out, columns)

    assert out.exists()
    assert len(report["경고"]) == 1
    assert "P-000002" in report["경고"][0] and "대표" in report["경고"][0]


def test_손대지_않은_상품의_고아_자식행은_경고일_뿐_막지_않는다(make_workbook, columns, tmp_path):
    """PROBE B — recipes.md §1 대로 대상 외 상품 행을 지웠는데 자식 행이 남은 워크북.

    서버는 고아 자식 행을 그 행만 오류로 떨군다(`bulk-upload.assembler.ts:81-88`)."""
    src = make_workbook("orphan.xlsx", {
        "상품": [{"rowKey": "P-000001", "name": "티셔츠", "basePrice": "19000"}],
        "옵션": [{"rowKey": "P-000002", "optionKey": "G1", "optionName": "색상",
                  "optionValueKey": "V1", "optionValueName": "빨강"}],
        "조합": [{"rowKey": "P-000002", "combination": "V1", "variantCode": "SKU-R"}],
        "카테고리": [{"rowKey": "P-000001", "categoryPath": "여성패션>티셔츠", "isPrimary": "Y"}],
    })
    out = tmp_path / "o.xlsx"

    report = apply_changes(src, {"변경": [{"상품키": "P-000001", "필드": {"brand": "NEW"}}]}, out, columns)

    assert out.exists()
    assert all("P-000002" in w for w in report["경고"])
    assert any("없는 상품키" in w for w in report["경고"])
    # ③ 이 보고한 행을 ④ 가 "옵션 시트에 없는 옵션값키" 로 또 세지 않는다
    assert not any("옵션값키를 참조" in w for w in report["경고"])


def test_경고가_있어도_손댄_상품의_위반은_여전히_파일을_막는다(make_workbook, columns, tmp_path):
    """스코프를 좁힌 것이 차단력을 잃은 것으로 번지지 않는지 본다 — 레거시 행의 경고와
    이번 작업의 위반이 한 워크북에 같이 있으면 결과는 차단이고 파일은 안 생긴다."""
    src = make_workbook("mixed.xlsx", {
        "상품": [{"rowKey": "P-000001", "name": "티셔츠", "basePrice": "19000"},
                 {"rowKey": "P-000002", "name": "레거시", "basePrice": "9000"}],
        "카테고리": [{"rowKey": "P-000002", "categoryPath": "여성패션>니트", "isPrimary": "N"}],
    })
    out = tmp_path / "o.xlsx"

    with pytest.raises(ValueError) as exc_info:
        apply_changes(src, {"변경": [{"상품키": "P-000001", "카테고리": [
            {"categoryPath": "여성패션>니트", "isPrimary": "Y"},
            {"categoryPath": "여성패션>티셔츠", "isPrimary": "Y"},
        ]}]}, out, columns)

    assert not out.exists()
    assert "P-000001" in str(exc_info.value)
    assert "P-000002" not in str(exc_info.value)   # 경고는 차단 메시지에 섞이지 않는다


def test_빈_양식에_예약키를_지으면_다른_키를_지으라고_안내한다(make_workbook, columns, tmp_path):
    """PROBE C — 빈 양식은 정상적으로 `_양식정보` 시트가 없다(form-export.workbook.ts:64-70).
    had_meta 로 분기하면 '양식을 다시 받아라' 라는 실행 불가능한 안내가 나간다 — 다시 받을
    프리필이 없다. 분기는 '원본에 있던 키인가' 여야 한다."""
    src = make_workbook("blank.xlsx", meta=False)

    with pytest.raises(ValueError) as exc_info:
        apply_changes(src, {"신규": [_new("P-000123")]}, tmp_path / "o.xlsx", columns)

    message = str(exc_info.value)
    assert "다른 상품키를 지어" in message
    assert "양식을 다시" not in message


def test_옵션이_있는데_조합이_비면_거부한다(prefilled_workbook, columns, tmp_path):
    """빈 조합은 '옵션 없는 상품의 단일 기본 품목' 계약이 있어(bulk-draft.options.ts:216)
    그 자체로는 정상이지만, 옵션 축이 있는 상품에서 비면 어느 옵션값에도 안 묶인 품목이 된다."""
    with pytest.raises(ValueError, match="조합"):
        apply_changes(
            prefilled_workbook,
            {"신규": [_new("NEW-1",
                           옵션=[{"optionKey": "G1", "optionName": "색상",
                                  "optionValueKey": "V9", "optionValueName": "검정"}],
                           조합=[{"variantCode": "SKU-K"}])]},   # '조합' 키를 생략
            tmp_path / "o.xlsx", columns,
        )


def test_옵션이_없는_상품의_빈_조합은_단일_기본_품목이라_통과한다(prefilled_workbook, columns, tmp_path):
    out = tmp_path / "o.xlsx"
    apply_changes(
        prefilled_workbook,
        {"신규": [_new("NEW-1", 조합=[{"variantCode": "SKU-ONLY"}])]},
        out, columns,
    )
    assert out.exists()


def test_이미지_원본이_URL_이면_거부한다(prefilled_workbook, columns, tmp_path):
    with pytest.raises(ValueError, match="URL"):
        apply_changes(
            prefilled_workbook,
            {"이미지": [{"imageKey": "IMG-9", "sourceValue": "https://example.com/a.jpg"}]},
            tmp_path / "o.xlsx", columns,
        )


def test_위반이_있으면_출력_파일을_아예_만들지_않는다(prefilled_workbook, columns, tmp_path):
    out = tmp_path / "o.xlsx"
    with pytest.raises(ValueError):
        apply_changes(prefilled_workbook, {"신규": [_new("P-000123")]}, out, columns)
    assert not out.exists()


def test_정상_변경은_통과한다(prefilled_workbook, columns, tmp_path):
    out = tmp_path / "o.xlsx"
    apply_changes(prefilled_workbook, {"변경": [{"상품키": "P-000001", "필드": {"brand": "NEW"}}]}, out, columns)
    assert out.exists()
