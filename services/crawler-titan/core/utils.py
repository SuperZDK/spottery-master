import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")

COMPANY_NAMES = {
    "asian":       {1: "澳门", 8: "365", 12: "易胜博", 17: "明升"},
    "over_under":  {1: "澳门", 8: "365", 12: "易胜博", 17: "明升"},
    "european":    {2: "betfair", 90: "易胜博", 104: "Interwetten", 115: "威廉希尔", 177: "Pinnacle", 281: "365"},
}


def get_company_name(odds_type: str, company_id: int) -> str:
    return COMPANY_NAMES.get(odds_type, {}).get(company_id, "")
