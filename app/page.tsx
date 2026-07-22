"use client";

import { useEffect, useMemo, useState } from "react";

type Market = "CN" | "HK" | "US";
type Confidence = "已确认" | "按条款推算" | "条件性事件";

type Company = {
  id: string;
  market: Market;
  symbol: string;
  name: string;
  fullName: string;
  exchange: string;
  industry: string;
  description: string;
  totalShares: string;
  floatShares: string;
};

type UnlockEvent = {
  id: string;
  companyId: string;
  date: string;
  shares: string;
  sharesValue: number;
  percentTotal: number;
  percentFloat: number;
  estimatedValue: string;
  type: string;
  confidence: Confidence;
  holders: string;
  source: string;
  sourceUrl?: string;
  verifiedAt: string;
};

const marketMeta: Record<Market, { label: string; className: string }> = {
  CN: { label: "A 股", className: "market-cn" },
  HK: { label: "港股", className: "market-hk" },
  US: { label: "美股", className: "market-us" },
};

const weekday = ["周一", "周二", "周三", "周四", "周五"];
const storageKey = "unlock-calendar:favorites:v1";

function isoDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function Home() {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [month, setMonth] = useState(new Date());
  const [market, setMarket] = useState<"ALL" | Market>("ALL");
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoritesReady, setFavoritesReady] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<UnlockEvent | null>(null);
  const [showAllFavorites, setShowAllFavorites] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [events, setEvents] = useState<UnlockEvent[]>([]);
  const [dataState, setDataState] = useState<"loading" | "live" | "error">("loading");
  const [fetchedAt, setFetchedAt] = useState("");
  const [historyEvents, setHistoryEvents] = useState<UnlockEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const companyOf = (event: UnlockEvent) => companies.find((company) => company.id === event.companyId)!;

  useEffect(() => {
    const controller = new AbortController();
    setDataState("loading");
    fetch(`${import.meta.env.BASE_URL}data/calendar.json`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("数据源暂时不可用");
        return response.json() as Promise<{ companies: Company[]; events: UnlockEvent[]; generatedAt: string }>;
      })
      .then((payload) => {
        setCompanies(payload.companies);
        setEvents(payload.events);
        setFetchedAt(payload.generatedAt);
        setDataState("live");
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDataState("error");
      });
    return () => controller.abort();
  }, [month]);

  useEffect(() => {
    if (!selectedEvent) {
      setHistoryEvents([]);
      return;
    }
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryEvents(events.filter((event) => event.companyId === selectedEvent.companyId).sort((a, b) => b.date.localeCompare(a.date)));
    setHistoryLoading(false);
    return () => controller.abort();
  }, [selectedEvent]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { items?: { securityId?: string }[] };
        setFavorites((parsed.items ?? []).map((item) => item.securityId).filter((id): id is string => Boolean(id)));
      }
    } catch { /* Local storage can be unavailable. */ }
    setFavoritesReady(true);
  }, []);

  useEffect(() => {
    if (!favoritesReady) return;
    const items = favorites.map((id) => {
      const c = companies.find((company) => company.id === id);
      return { securityId: id, market: c?.market, symbol: c?.symbol, companyName: c?.name, createdAt: new Date().toISOString() };
    });
    try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, items })); } catch { /* Keep the app usable. */ }
  }, [favorites, favoritesReady]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== storageKey || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue) as { items?: { securityId: string }[] };
        setFavorites((parsed.items ?? []).map((item) => item.securityId));
      } catch { /* Ignore invalid data from another tab. */ }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const filteredEvents = useMemo(() => events.filter((event) => {
    if (market === "ALL") return true;
    return companies.find((company) => company.id === event.companyId)?.market === market;
  }), [market, events, companies]);
  const monthEvents = filteredEvents.filter((event) => event.date.startsWith(`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`));
  const companyCount = new Set(monthEvents.map((event) => event.companyId)).size;
  const confirmedCount = monthEvents.filter((event) => event.confidence === "已确认").length;
  const totalShares = monthEvents.reduce((sum, event) => sum + event.sharesValue, 0);

  const searchResults = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return [];
    return companies
      .filter((company) => market === "ALL" || company.market === market)
      .filter((company) => `${company.symbol} ${company.name} ${company.fullName}`.toLowerCase().includes(keyword))
      .sort((a, b) => Number(b.symbol.toLowerCase() === keyword) - Number(a.symbol.toLowerCase() === keyword))
      .slice(0, 8);
  }, [query, market]);

  const favoriteCompanies = useMemo(() => favorites
    .map((id) => companies.find((company) => company.id === id))
    .filter((company): company is Company => Boolean(company))
    .sort((a, b) => {
      const aDate = events.filter((event) => event.companyId === a.id && event.date >= todayIso).sort((x, y) => x.date.localeCompare(y.date))[0]?.date ?? "9999";
      const bDate = events.filter((event) => event.companyId === b.id && event.date >= todayIso).sort((x, y) => x.date.localeCompare(y.date))[0]?.date ?? "9999";
      return aDate.localeCompare(bDate);
    }), [favorites, companies, events, todayIso]);

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  }).filter((date) => date.getDay() !== 0 && date.getDay() !== 6);

  const toggleFavorite = (id: string) => setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const nextEvent = (companyId: string) => events.filter((event) => event.companyId === companyId && event.date >= todayIso).sort((a, b) => a.date.localeCompare(b.date))[0];
  const formatDate = (value: string) => `${Number(value.slice(5, 7))}月${Number(value.slice(8, 10))}日`;
  const monthLabel = `${month.getFullYear()}年 ${month.getMonth() + 1}月`;

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="解禁雷达首页">
          <span className="brand-mark">解</span>
          <span><strong>解禁雷达</strong><small>Unlock Radar</small></span>
        </a>
        <nav><a className="active" href="#calendar">解禁日历</a><a href="#favorites">我的收藏</a><a href="#methodology">数据说明</a></nav>
        <div className="header-meta"><span className={`live-dot ${dataState}`} /> {dataState === "loading" ? "正在同步真实数据" : dataState === "error" ? "数据源暂时不可用" : `实时数据 · ${fetchedAt.slice(5, 16).replace("T", " ")}`} <button aria-label="帮助">?</button></div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <span className="eyebrow">GLOBAL EQUITY UNLOCK CALENDAR</span>
          <h1>看清下一次<br /><em>股份供给变化</em></h1>
          <p>集中追踪 A 股、港股与美股公司的限售股解禁及锁定期到期事件。每条数据都标记来源与确认状态。</p>
        </div>
        <div className="hero-stats">
          <div><span>本月事件</span><strong>{monthEvents.length}</strong><small>笔解禁记录</small></div>
          <div><span>涉及公司</span><strong>{companyCount}</strong><small>家上市公司</small></div>
          <div><span>确认事件</span><strong>{confirmedCount}</strong><small>已由公告确认</small></div>
        </div>
      </section>

      <section className="search-zone">
        <div className={`search-box ${query ? "focused" : ""}`}>
          <span className="search-icon">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索公司名称或股票代码，例如：宁德时代 / 300750 / ARM" aria-label="搜索公司" />
          {query && <button onClick={() => setQuery("")} aria-label="清除搜索">×</button>}
          {query && <div className="search-results">
            {searchResults.length ? searchResults.map((company) => {
              const upcoming = nextEvent(company.id);
              return <div className="search-row" key={company.id}>
                <button className="search-main" onClick={() => upcoming && setSelectedEvent(upcoming)}>
                  <span className={`market-pill ${marketMeta[company.market].className}`}>{marketMeta[company.market].label}</span>
                  <strong>{company.name}</strong><code>{company.symbol}</code>
                  <span className="search-next">{upcoming ? `下次解禁 ${formatDate(upcoming.date)}` : "暂无未来解禁"}</span>
                </button>
                <button className={`star ${favorites.includes(company.id) ? "selected" : ""}`} onClick={() => toggleFavorite(company.id)} aria-label={`收藏${company.name}`}>★</button>
              </div>;
            }) : <div className="search-empty">未找到已收录公司，请尝试其他名称或代码</div>}
          </div>}
        </div>
        <div className="market-tabs" aria-label="市场筛选">
          {(["ALL", "CN", "HK", "US"] as const).map((value) => <button key={value} className={market === value ? "active" : ""} onClick={() => setMarket(value)}>{value === "ALL" ? "全部市场" : marketMeta[value].label}</button>)}
        </div>
      </section>

      <section className="favorites-section" id="favorites">
        <div className="section-heading">
          <div><span className="section-kicker">WATCHLIST</span><h2>我的收藏 <b>{favorites.length}</b></h2></div>
          {favorites.length > 0 && <button className="text-button" onClick={() => window.confirm("确定清空全部收藏公司吗？") && setFavorites([])}>清空收藏</button>}
        </div>
        {!favoritesReady ? <div className="favorite-skeleton" /> : favoriteCompanies.length === 0 ? (
          <div className="empty-favorites"><span>☆</span><div><strong>还没有收藏公司</strong><p>从上方搜索结果或日历公司右侧的星标添加，收藏会保存在当前浏览器。</p></div></div>
        ) : <div className="favorite-grid">
          {(showAllFavorites ? favoriteCompanies : favoriteCompanies.slice(0, 6)).map((company) => {
            const upcoming = nextEvent(company.id);
            return <article className="favorite-card" key={company.id}>
              <div className="favorite-top"><span className={`market-pill ${marketMeta[company.market].className}`}>{marketMeta[company.market].label}</span><button className="star selected" onClick={() => toggleFavorite(company.id)} aria-label={`取消收藏${company.name}`}>★</button></div>
              <h3>{company.name}</h3><code>{company.symbol}</code>
              {upcoming ? <button className="next-unlock" onClick={() => setSelectedEvent(upcoming)}><span>下一次解禁 · {formatDate(upcoming.date)}</span><strong>{upcoming.shares}</strong><small>占总股本 {upcoming.percentTotal.toFixed(2)}% →</small></button> : <div className="no-unlock">暂无未来解禁</div>}
            </article>;
          })}
          {favoriteCompanies.length > 6 && <button className="show-all" onClick={() => setShowAllFavorites((value) => !value)}>{showAllFavorites ? "收起" : `查看全部 ${favoriteCompanies.length} 家`}</button>}
        </div>}
      </section>

      <section className="calendar-section" id="calendar">
        <div className="calendar-toolbar">
          <div><span className="section-kicker">MONTHLY OVERVIEW</span><h2>解禁月历</h2></div>
          <div className="calendar-nav"><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="上个月">‹</button><strong>{monthLabel}</strong><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="下个月">›</button><button className="today" onClick={() => setMonth(new Date(2026, 6, 1))}>本月</button></div>
          <div className="legend"><span><i className="dot confirmed" />已确认</span><span><i className="dot calculated" />推算</span><span><i className="dot conditional" />条件性</span></div>
        </div>
        <div className="calendar-shell">
          <div className="weekdays">{weekday.map((day) => <div key={day}>{day}</div>)}</div>
          <div className="calendar-grid">
            {days.map((date) => {
              const key = isoDate(date);
              const dayEvents = filteredEvents.filter((event) => event.date === key);
              const outside = date.getMonth() !== month.getMonth();
              const today = key === todayIso;
              return <div className={`day ${outside ? "outside" : ""} ${today ? "is-today" : ""}`} key={key}>
                <div className="day-number"><span>{date.getDate()}</span>{today && <b>今天</b>}{dayEvents.length > 0 && <small>{dayEvents.length} 笔</small>}</div>
                <div className="day-events">{dayEvents.map((event) => {
                  const company = companyOf(event);
                  return <div role="button" tabIndex={0} className={`event-card ${event.confidence === "已确认" ? "event-confirmed" : event.confidence === "按条款推算" ? "event-calculated" : "event-conditional"}`} key={event.id} onClick={() => setSelectedEvent(event)} onKeyDown={(keyEvent) => { if (keyEvent.key === "Enter" || keyEvent.key === " ") setSelectedEvent(event); }}>
                    <span className="event-company"><i className={marketMeta[company.market].className}>{company.market === "CN" ? "A" : company.market}</i><strong>{company.name}</strong><button className={`mini-star ${favorites.includes(company.id) ? "selected" : ""}`} onClick={(click) => { click.stopPropagation(); toggleFavorite(company.id); }} aria-label={`收藏${company.name}`}>★</button></span>
                    <span className="event-metric"><b>{event.shares}</b><em>{event.percentTotal.toFixed(2)}%</em></span>
                  </div>;
                })}</div>
              </div>;
            })}
          </div>
        </div>
        <div className="calendar-footnote"><span>ℹ</span> A 股解禁记录实时取自公开数据接口；港股与美股仅展示已完成官方披露解析的事件。解禁不等于实际减持。</div>
      </section>

      <section className="methodology" id="methodology">
        <div><span className="section-kicker">METHODOLOGY</span><h2>一眼看懂数据可信度</h2></div>
        <div className="method-grid"><article><b>01</b><h3>原始文件优先</h3><p>优先追溯至交易所公告、HKEXnews 或 SEC filing，而不是匿名聚合数据。</p></article><article><b>02</b><h3>状态明确分级</h3><p>公告确认、按条款推算和条件性事件始终分开显示，不把估算包装成事实。</p></article><article><b>03</b><h3>解禁不等于减持</h3><p>股份获得流通资格不代表股东一定卖出，页面不提供确定性的涨跌判断。</p></article></div>
      </section>

      <footer><div className="brand footer-brand"><span className="brand-mark">解</span><span><strong>解禁雷达</strong><small>Unlock Radar</small></span></div><p>让股份供给变化更透明</p><span>数据仅供参考，不构成投资建议</span></footer>

      {selectedEvent && (() => {
        const company = companyOf(selectedEvent);
        return <div className="modal-backdrop" onMouseDown={() => setSelectedEvent(null)}>
          <aside className="detail-panel" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${company.name}解禁详情`}>
            <div className="detail-header"><div><span className={`market-pill ${marketMeta[company.market].className}`}>{marketMeta[company.market].label}</span><code>{company.symbol}</code></div><button onClick={() => setSelectedEvent(null)} aria-label="关闭">×</button></div>
            <div className="company-title"><div><h2>{company.name}</h2><p>{company.fullName}</p></div><button className={`favorite-action ${favorites.includes(company.id) ? "selected" : ""}`} onClick={() => toggleFavorite(company.id)}>★ {favorites.includes(company.id) ? "已收藏" : "收藏公司"}</button></div>
            <div className="company-meta"><span>{company.exchange}</span><span>{company.industry}</span></div>
            <div className="detail-date"><span>解禁日期</span><strong>{selectedEvent.date.replaceAll("-", ".")}</strong><b className={selectedEvent.confidence === "已确认" ? "status-confirmed" : "status-estimated"}>{selectedEvent.confidence}</b></div>
            <div className="metric-grid"><div><span>本次解禁</span><strong>{selectedEvent.shares}</strong></div><div><span>占总股本</span><strong>{selectedEvent.percentTotal.toFixed(2)}%</strong></div><div><span>占解禁前流通股</span><strong>{selectedEvent.percentFloat.toFixed(2)}%</strong></div><div><span>估算解禁市值</span><strong>{selectedEvent.estimatedValue}</strong></div></div>
            <section className="detail-section"><h3>事件信息</h3><dl><div><dt>股份类型</dt><dd>{selectedEvent.type}</dd></div><div><dt>涉及持有人</dt><dd>{selectedEvent.holders}</dd></div><div><dt>总股本</dt><dd>{company.totalShares}</dd></div><div><dt>当前流通股本</dt><dd>{company.floatShares}</dd></div></dl></section>
            <section className="detail-section"><h3>公司简况</h3><p>{company.description}</p></section>
            <section className="detail-section history-section">
              <h3>历史解禁记录 <span>{historyLoading ? "同步中…" : `${historyEvents.length} 笔`}</span></h3>
              {historyLoading ? <div className="history-loading">正在从数据源获取该公司的全部解禁记录</div> : historyEvents.length > 0 ? <div className="history-list">
                {historyEvents.map((history) => <button key={history.id} className={history.id === selectedEvent.id ? "current" : ""} onClick={() => setSelectedEvent(history)}>
                  <time>{history.date}</time><div><strong>{history.type}</strong><small>{history.shares} · 占总股本 {history.percentTotal.toFixed(2)}%</small></div><span>›</span>
                </button>)}
              </div> : <div className="history-loading">暂未取得该公司的其他历史解禁记录</div>}
            </section>
            <section className="source-card"><span>数据来源</span><strong>{selectedEvent.source}</strong><small>最后核验：{selectedEvent.verifiedAt}</small>{selectedEvent.sourceUrl && <a href={selectedEvent.sourceUrl} target="_blank" rel="noreferrer">查看来源页面 ↗</a>}</section>
            <p className="disclaimer">解禁仅代表股份取得流通资格，不代表相关股东必然减持。本页不构成投资建议。</p>
          </aside>
        </div>;
      })()}
    </main>
  );
}
