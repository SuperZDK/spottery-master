from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

from app.routers.auth import _current_user
from app.schemas.matches import DailyMatchesResponse, MatchDetailResponse
from app.services import jc_daily, match_detail

router = APIRouter(tags=["matches"])


@router.get("/matches", response_model=DailyMatchesResponse)
def list_matches(
    source: str = Query("jingcai", pattern="^(jingcai|sofascore|titan007)$"),
    business_date: str | None = Query(None, description="竞彩销售日 YYYY-MM-DD，缺省取今天"),
    _=Depends(_current_user),
) -> DailyMatchesResponse:
    """竞彩日赛列表（5 池最新赔率）。

    数据源按 business_date 排干状态自动切换：
    - 未排干（workset 内）→ 读 crawler-sporttery JSON
    - 已排干（<= completeDate）→ 读 sporttery 源库
    """
    target = business_date or date.today().isoformat()
    if source == "jingcai":
        return jc_daily.get_daily(target)
    # 其余 source 后续阶段实现
    return DailyMatchesResponse(date=target, weekday="", source="empty", matches=[])


@router.get("/matches/{match_id}", response_model=MatchDetailResponse)
def get_match_detail(
    match_id: int,
    source: str = Query("jingcai", pattern="^(jingcai|titan|sofascore)$"),
    _=Depends(_current_user),
) -> MatchDetailResponse:
    """比赛详情（统一接口）。

    - source 默认 jingcai（首页赛程列表进入，只传 match_id 即可）
    - titan/sofascore 入口：反查 core.cross_source_matches 得到竞彩 match_id
    - 当前返回：比赛信息头 + 5 池赔率全纪录；其余数据域后续接入
    """
    detail = match_detail.get_match_detail(match_id, source)
    if detail is None:
        raise HTTPException(status_code=404, detail="Match not found")
    return detail
