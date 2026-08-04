from read_form import read_form


def test_상품_단위로_조인된다(prefilled_workbook, columns):
    out = read_form(prefilled_workbook, columns)

    assert len(out["products"]) == 1
    product = out["products"][0]
    assert product["상품키"] == "P-000001"
    assert product["필드"]["name"] == "티셔츠"
    assert len(product["옵션"]) == 2
    assert len(product["조합"]) == 2
    assert product["카테고리"][0]["categoryPath"] == "여성패션>티셔츠"
    assert product["구매제약"] is None


def test_숨은_시트의_exportId_를_읽는다(prefilled_workbook, columns):
    out = read_form(prefilled_workbook, columns)
    assert out["exportId"] == "0198f3a1-1111-7000-8000-abcdefabcdef"


def test_exportId_가_있으면_출처가_프리필이다(prefilled_workbook, columns):
    out = read_form(prefilled_workbook, columns)
    assert out["products"][0]["출처"] == "프리필"


def test_고아_자식행이_없으면_고아행은_빈_목록이다(prefilled_workbook, columns):
    assert read_form(prefilled_workbook, columns)["고아행"] == []


def test_상품_시트에_없는_상품키의_자식행을_고아행으로_드러낸다(make_workbook, columns):
    """조용히 버리면 AI 는 읽기 결과에서 그 행을 볼 수 없는데 write 에서 그것 때문에
    경고·거부를 받아 원인이 보이지 않는 막다른 길이 된다. `products` 구조는 그대로 둔다."""
    src = make_workbook("orphan.xlsx", {
        "상품": [{"rowKey": "P-000001", "name": "티셔츠", "basePrice": "19000"}],
        "옵션": [{"rowKey": "P-000002", "optionKey": "G1", "optionName": "색상",
                  "optionValueKey": "V1", "optionValueName": "빨강"}],
        "조합": [{"rowKey": "P-000002", "combination": "V1", "variantCode": "SKU-R"}],
        "카테고리": [{"rowKey": "P-000001", "categoryPath": "여성패션>티셔츠", "isPrimary": "Y"}],
        "구매제약": [{"rowKey": "P-000003", "requiresMembership": "Y"}],
    })

    out = read_form(src, columns)

    assert [o["시트"] for o in out["고아행"]] == ["옵션", "조합", "구매제약"]
    assert {o["rowKey"] for o in out["고아행"]} == {"P-000002", "P-000003"}   # 어느 상품인지가 단서다

    # products 구조는 그대로 — 문서와 테스트가 이 모양에 의존한다
    assert len(out["products"]) == 1
    assert out["products"][0]["옵션"] == [] and out["products"][0]["구매제약"] is None


def test_카테고리_참조는_경로_목록으로_나온다(prefilled_workbook, columns):
    out = read_form(prefilled_workbook, columns)
    assert out["카테고리참조"] == ["여성패션>티셔츠", "여성패션>니트"]


def test_헤더_이름으로_찾으므로_열_순서가_바뀌어도_읽는다(tmp_path, columns):
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "상품"
    ws.append(["판매가", "상품명", "상품키"])   # 순서를 뒤집는다
    ws.append(["19000", "티셔츠", "NEW-1"])
    path = tmp_path / "reordered.xlsx"
    wb.save(path)

    out = read_form(path, columns)
    assert out["products"][0]["필드"]["name"] == "티셔츠"
    assert out["products"][0]["출처"] == "신규"
