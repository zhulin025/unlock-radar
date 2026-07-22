import officialEvents from "../../../data/official-events.json";

export const runtime = "edge";

type Market = "CN" | "HK" | "US";

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
  confidence: "已确认" | "按条款推算" | "条件性事件";
  holders: string;
  source: string;
  sourceUrl?: string;
  verifiedAt: string;
};

const EASTMONEY_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";

function formatShares(wanShares: number) {
  if (!Number.isFinite(wanShares)) return "未披露";
  if (wanShares >= 10000) return `${(wanShares / 10000).toFixed(2)} 亿股`;
  return `${wanShares.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 万股`;
}

function marketOf(symbol: string) {
  if (symbol.endsWith(".SH")) return { exchange: "上海证券交易所", prefix: "sh" };
  if (symbol.endsWith(".BJ")) return { exchange: "北京证券交易所", prefix: "bj" };
  return { exchange: "深圳证券交易所", prefix: "sz" };
}

async function fetchAshareMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, monthNumber, 0));
  const end = `${year}-${String(monthNumber).padStart(2, "0")}-${String(endDate.getUTCDate()).padStart(2, "0")}`;
  const filter = `(FREE_DATE>='${start}')(FREE_DATE<='${end}')`;
  const firstParams = new URLSearchParams({ reportName: "RPT_LIFT_STAGE", columns: "ALL", filter, pageNumber: "1", pageSize: "500", sortColumns: "FREE_DATE", sortTypes: "1", source: "WEB", client: "WEB" });
  const response = await fetch(`${EASTMONEY_URL}?${firstParams}`, { headers: { "User-Agent": "UnlockRadar/0.1 (+local research tool)", Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`A-share source returned ${response.status}`);
  const payload = await response.json() as { result?: { data?: Record<string, unknown>[]; pages?: number } };
  const rows = [...(payload.result?.data ?? [])];
  const pages = Math.min(Number(payload.result?.pages ?? 1), 20);
  for (let page = 2; page <= pages; page += 1) {
    const pageParams = new URLSearchParams(firstParams);
    pageParams.set("pageNumber", String(page));
    const pageResponse = await fetch(`${EASTMONEY_URL}?${pageParams}`, { headers: { "User-Agent": "UnlockRadar/0.1 (+local research tool)", Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
    if (!pageResponse.ok) throw new Error(`A-share page ${page} returned ${pageResponse.status}`);
    const pagePayload = await pageResponse.json() as { result?: { data?: Record<string, unknown>[] } };
    rows.push(...(pagePayload.result?.data ?? []));
  }
  const companyMap = new Map<string, Company>();
  const events: UnlockEvent[] = [];

  for (const row of rows) {
    const symbol = String(row.SECUCODE ?? row.SECURITY_CODE ?? "");
    const code = String(row.SECURITY_CODE ?? symbol.split(".")[0]);
    const { exchange, prefix } = marketOf(symbol);
    const companyId = `cn-${prefix}-${code}`;
    const freeWan = Number(row.FREE_SHARES ?? 0);
    const ableWan = Number(row.ABLE_FREE_SHARES ?? freeWan);
    const currentFreeWan = Number(row.CURRENT_FREE_SHARES ?? 0);
    const ratio = Number(row.FREE_RATIO ?? 0);
    const totalWan = ratio > 0 ? freeWan / ratio : 0;
    const marketCapWan = Number(row.ALIFT_MARKET_CAP ?? row.LIFT_MARKET_CAP ?? 0);
    const date = String(row.FREE_DATE ?? "").slice(0, 10);
    const name = String(row.SECURITY_NAME_ABBR ?? code);

    if (!companyMap.has(companyId)) companyMap.set(companyId, {
      id: companyId,
      market: "CN",
      symbol: code,
      name,
      fullName: name,
      exchange,
      industry: "A 股上市公司",
      description: "公司基础资料将在交易所公告与证券信息源核验后补充。",
      totalShares: totalWan > 0 ? formatShares(totalWan) : "未披露",
      floatShares: currentFreeWan > 0 ? formatShares(currentFreeWan) : "未披露",
    });

    events.push({
      id: `cn-${code}-${date}-${String(row.FREE_SHARES_TYPE ?? "unlock")}`,
      companyId,
      date,
      shares: formatShares(freeWan),
      sharesValue: freeWan * 10000,
      percentTotal: ratio * 100,
      percentFloat: currentFreeWan > 0 ? Math.min(ableWan / currentFreeWan * 100, 999.99) : 0,
      estimatedValue: marketCapWan > 0 ? `≈ ${(marketCapWan / 10000).toFixed(2)} 亿元` : "未披露",
      type: String(row.FREE_SHARES_TYPE ?? "限售股份解禁"),
      confidence: "已确认",
      holders: Number(row.BATCH_HOLDER_NUM ?? 0) > 0 ? `涉及 ${Number(row.BATCH_HOLDER_NUM)} 名股东` : "持有人信息请查看原始公告",
      source: "东方财富数据中心 · 限售股解禁（交易所公告聚合）",
      sourceUrl: "https://data.eastmoney.com/dxf/",
      verifiedAt: String(row.EUTIME ?? new Date().toISOString()).replace("T", " ").slice(0, 16),
    });
  }

  return { companies: [...companyMap.values()], events };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return Response.json({ error: "Invalid month" }, { status: 400 });

  try {
    const cn = await fetchAshareMonth(month);
    const official = officialEvents as { companies: Company[]; events: UnlockEvent[]; generatedAt: string | null };
    const monthEvents = official.events.filter((event) => event.date.startsWith(month));
    const officialIds = new Set(monthEvents.map((event) => event.companyId));
    return Response.json({
      companies: [...cn.companies, ...official.companies.filter((company) => officialIds.has(company.id))],
      events: [...cn.events, ...monthEvents],
      meta: {
        month,
        live: true,
        fetchedAt: new Date().toISOString(),
        sources: [
          { market: "CN", status: "live", label: "东方财富限售股解禁（交易所公告聚合）" },
          { market: "HK", status: official.events.some((event) => event.companyId.startsWith("hk-")) ? "parsed" : "awaiting-sync", label: "HKEXnews 官方披露解析" },
          { market: "US", status: official.events.some((event) => event.companyId.startsWith("us-")) ? "parsed" : "awaiting-sync", label: "SEC EDGAR 官方文件解析" },
        ],
      },
    }, { headers: { "Cache-Control": "public, max-age=900, stale-while-revalidate=3600" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Data source unavailable", month }, { status: 502 });
  }
}
