import logging

logger = logging.getLogger(__name__)


def test_import_core():
    from core import models
    from core import utils
    from core import odds_parser
    from core import parser
    from core import version_detector
    from core import ns_parser
    from core import js_fetcher
    from core import workset
    logger.info("All core modules imported successfully")


def test_models_basic():
    from core.models import MatchInfo, AsianOddsItem, EuroOddsItem, OverUnderItem
    m = MatchInfo(schedule_id=1, hometeam="A", guestteam="B", match_time="2026-01-01",
                  league_id=1, league_name_cn="Test", season="2026")
    assert m.schedule_id == 1
    logger.info(f"MatchInfo created: {m.hometeam} vs {m.guestteam}")


def test_utils_basic():
    from core.utils import get_company_name
    assert get_company_name("asian", 1) == "澳门"
    assert get_company_name("european", 115) == "威廉希尔"
    logger.info("Company name mapping OK")


def test_workset_import():
    from core.workset import Workset, is_terminal
    assert is_terminal({"status": -1}) is True
    assert is_terminal({"status": -10}) is True
    assert is_terminal({"status": 0}) is False
    logger.info("workset helpers OK")
