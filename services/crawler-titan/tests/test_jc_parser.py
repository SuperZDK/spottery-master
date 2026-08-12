from core import jc_parser

# JcResult month fields are 0-based (0=1月 ... 11=12月), so '2026,6,4'
# in the raw text means 2026-07-04.
SAMPLE = (
    "75^#660000^^\u4e16\u754c\u676f,\u4e16\u754c\u76c3^,^cupmatch.aspx?sclassid=75!"
    "13^#003db9^1570^\u82ac\u8d85,\u82ac\u8d85^,^subleague.aspx?sclassid=13!"
    "15^#0542b1^313^\u97e9K\u8054,\u97d3K\u806f^,^subleague.aspx?sclassid=15$"
    "2929645^2026,6,4,18,30,00^2026,6,4,19,34,17^-1^\u5468\u516d201^15^313^21249^"
    "FC\u5b89\u517b,FC\u5b89\u990a,\u5b89\u517bFC^481^\u6d66\u9879\u5236\u94c1,"
    "\u6d66\u9805\u5236\u9435,\u6d66\u9879\u5236\u94c1^2^3^1^1^0^1^1^4^7^5^"
    "2026,6,4,00,00,00^0^0!"
    "2991117^2026,6,4,22,00,00^2026,6,4,23,01,00^-1^\u5468\u516d202^75^1^347^"
    "\u5df4\u897f\u68ee\u6797,\u5df4\u897f\u68ee\u6797^462^\u7ef4\u62c9\u7eb3,"
    "\u7ef4\u62c9\u7eb3^1^2^0^1^0^0^1^2^3^4^2026,6,4,00,00,00^0.5^0"
)


def test_parse_competitions():
    parsed = jc_parser.parse_jc_result(SAMPLE, "2026-07-04")
    comps = parsed["competitions"]
    assert set(comps) == {75, 13, 15}
    assert comps[75]["is_cup"] is True
    assert comps[75]["name_cn"] == "\u4e16\u754c\u676f"
    assert comps[13]["is_cup"] is False
    assert comps[15]["name_cn"] == "\u97e9K\u8054"


def test_parse_match_row():
    parsed = jc_parser.parse_jc_result(SAMPLE, "2026-07-04")
    matches = parsed["matches"]
    assert len(matches) == 2

    m = matches[0]
    assert m["sid"] == 2929645
    assert m["match_num"] == "\u5468\u516d201"
    assert m["sclass_id"] == 15
    assert m["kickoff"] == "2026-07-04 18:30"
    assert m["home_team_id"] == 21249
    assert m["home_team"] == "FC\u5b89\u517b"
    assert m["home_team_en"] == "\u5b89\u517bFC"
    assert m["away_team_id"] == 481
    assert m["away_team"] == "\u6d66\u9879\u5236\u94c1"
    assert m["full_score"] == "2-3"
    assert m["half_score"] == "1-1"
    assert m["status"] == -1
    assert m["business_date"] == "2026-07-04"

    m2 = matches[1]
    assert m2["sid"] == 2991117
    assert m2["sclass_id"] == 75
    assert m2["kickoff"] == "2026-07-04 22:00"
    assert m2["full_score"] == "1-2"
    assert m2["half_score"] == "0-1"


def test_norm_date_month_zero_based_boundaries():
    # month 0 -> January
    assert jc_parser._norm_date("2026,0,15,18,30,00") == "2026-01-15 18:30"
    # month 11 -> December
    assert jc_parser._norm_date("2026,11,31,18,30,00") == "2026-12-31 18:30"
    # 00:00:00 keeps time (midnight is a real kickoff; no longer collapsed to date-only)
    assert jc_parser._norm_date("2026,11,31,00,00,00") == "2026-12-31 00:00"
    # empty / malformed passthrough
    assert jc_parser._norm_date("") == ""
    assert jc_parser._norm_date("not-a-date") == "not-a-date"


def test_empty():
    parsed = jc_parser.parse_jc_result("", "2026-06-04")
    assert parsed["matches"] == []
    assert parsed["competitions"] == {}


def test_fetch_returns_none_on_failure(monkeypatch):
    import urllib.request

    def boom(*args, **kwargs):
        raise urllib.error.URLError("getaddrinfo failed")

    monkeypatch.setattr(jc_parser.urllib.request, "urlopen", boom)
    assert jc_parser.fetch_jc_result("2026-04-25") is None


def test_fetch_success(monkeypatch):
    import io

    class FakeResp:
        def __init__(self, data):
            self._data = data

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def read(self):
            return self._data

    monkeypatch.setattr(
        jc_parser.urllib.request, "urlopen",
        lambda *a, **k: FakeResp(SAMPLE.encode("utf-8")))
    assert jc_parser.fetch_jc_result("2026-06-04") == SAMPLE
