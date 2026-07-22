import officialEvents from "../../../../../data/official-events.json";

export const runtime = "edge";

const EASTMONEY_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";

function formatShares(wanShares: number) {
  if (!Number.isFinite(wanShares)) return "未披露";
  if (wanShares >= 10000) return `${(wanShares / 10000).toFixed(2)} 亿股`;
  return `${wanShares.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 万股`;
}

async function fetchAshareHistory(companyId: string) {
  const code = companyId.split("-").at(-1) ?? "";
  if (!/^\d{6}$/.test(code)) return [];
  const filter = `(SECURITY_CODE="${code}")`;
  const params = new URLSearchParams({ reportName: "RPT_LIFT_STAGE", columns: "ALL", filter, pageNumber: "1", pageSize: "500", sortColumns: "FREE_DATE", sortTypes: "-1", source: "WEB", client: "WEB" });
  const response = await fetch(`${EASTMONEY_URL}?${params}`, { headers: { "User-Agent": "UnlockRadar/0.1 (+local research tool)", Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`History source returned ${response.status}`);
  const payload = await response.json() as { result?: { data?: Record<string, unknown>[] } };
  return (payload.result?.data ?? []).map((row) => {
    const freeWan = Number(row.FREE_SHARES ?? 0);
    const ableWan = Number(row.ABLE_FREE_SHARES ?? freeWan);
    const currentFreeWan = Number(row.CURRENT_FREE_SHARES ?? 0);
    const marketCapWan = Number(row.ALIFT_MARKET_CAP ?? row.LIFT_MARKET_CAP ?? 0);
    const date = String(row.FREE_DATE ?? "").slice(0, 10);
    return {
      id: `cn-${code}-${date}-${String(row.FREE_SHARES_TYPE ?? "unlock")}`,
      companyId,
      date,
      shares: formatShares(freeWan),
      sharesValue: freeWan * 10000,
      percentTotal: Number(row.FREE_RATIO ?? 0) * 100,
      percentFloat: currentFreeWan > 0 ? Math.min(ableWan / currentFreeWan * 100, 999.99) : 0,
      estimatedValue: marketCapWan > 0 ? `≈ ${(marketCapWan / 10000).toFixed(2)} 亿元` : "未披露",
      type: String(row.FREE_SHARES_TYPE ?? "限售股份解禁"),
      confidence: "已确认" as const,
      holders: Number(row.BATCH_HOLDER_NUM ?? 0) > 0 ? `涉及 ${Number(row.BATCH_HOLDER_NUM)} 名股东` : "持有人信息请查看来源公告",
      source: "东方财富数据中心 · 限售股解禁（交易所公告聚合）",
      sourceUrl: "https://data.eastmoney.com/dxf/",
      verifiedAt: String(row.EUTIME ?? "").slice(0, 16),
    };
  });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const events = id.startsWith("cn-")
      ? await fetchAshareHistory(id)
      : (officialEvents.events as Array<Record<string, unknown>>).filter((event) => event.companyId === id);
    return Response.json({ companyId: id, events, count: events.length, fetchedAt: new Date().toISOString() }, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "History unavailable", companyId: id }, { status: 502 });
  }
}
