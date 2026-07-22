import { mkdir, readFile, writeFile } from "node:fs/promises";

const source = JSON.parse(await readFile(new URL("../data/official-events.json", import.meta.url), "utf8"));
const output = new URL("../public/data/calendar.json", import.meta.url);
const endpoint = "https://datacenter-web.eastmoney.com/api/data/v1/get";

function fmt(value) {
  if (!Number.isFinite(value)) return "未披露";
  return value >= 10000 ? `${(value / 10000).toFixed(2)} 亿股` : `${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 万股`;
}

function exchange(symbol) {
  if (symbol.endsWith(".SH")) return ["上海证券交易所", "sh"];
  if (symbol.endsWith(".BJ")) return ["北京证券交易所", "bj"];
  return ["深圳证券交易所", "sz"];
}

async function monthRows(year, month) {
  const mm = String(month).padStart(2, "0");
  const end = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const filter = `(FREE_DATE>='${year}-${mm}-01')(FREE_DATE<='${year}-${mm}-${end}')`;
  const base = new URLSearchParams({ reportName: "RPT_LIFT_STAGE", columns: "ALL", filter, pageNumber: "1", pageSize: "500", sortColumns: "FREE_DATE", sortTypes: "1", source: "WEB", client: "WEB" });
  const rows = [];
  for (let page = 1; page <= 20; page += 1) {
    base.set("pageNumber", String(page));
    const response = await fetch(`${endpoint}?${base}`, { headers: { "User-Agent": "UnlockRadar/1.0 data sync", Accept: "application/json" } });
    if (!response.ok) throw new Error(`A-share ${year}-${mm} page ${page}: ${response.status}`);
    const payload = await response.json();
    rows.push(...(payload.result?.data || []));
    if (page >= Number(payload.result?.pages || 1)) break;
  }
  return rows;
}

const now = new Date();
const startYear = Number(process.env.DATA_START_YEAR || now.getUTCFullYear() - 3);
const endYear = Number(process.env.DATA_END_YEAR || now.getUTCFullYear() + 2);
const companies = new Map(source.companies.map((item) => [item.id, item]));
const events = new Map(source.events.map((item) => [item.id, item]));

for (let year = startYear; year <= endYear; year += 1) {
  for (let month = 1; month <= 12; month += 1) {
    const rows = await monthRows(year, month);
    for (const row of rows) {
      const symbol = String(row.SECUCODE || row.SECURITY_CODE || "");
      const code = String(row.SECURITY_CODE || symbol.split(".")[0]);
      const [exchangeName, prefix] = exchange(symbol);
      const companyId = `cn-${prefix}-${code}`;
      const freeWan = Number(row.FREE_SHARES || 0);
      const ableWan = Number(row.ABLE_FREE_SHARES || freeWan);
      const currentWan = Number(row.CURRENT_FREE_SHARES || 0);
      const ratio = Number(row.FREE_RATIO || 0);
      const valueWan = Number(row.ALIFT_MARKET_CAP || row.LIFT_MARKET_CAP || 0);
      const date = String(row.FREE_DATE || "").slice(0, 10);
      const name = String(row.SECURITY_NAME_ABBR || code);
      companies.set(companyId, { id: companyId, market: "CN", symbol: code, name, fullName: name, exchange: exchangeName, industry: "A 股上市公司", description: "公司基础资料来自公开交易所公告聚合数据。", totalShares: ratio > 0 ? fmt(freeWan / ratio) : "未披露", floatShares: currentWan > 0 ? fmt(currentWan) : "未披露" });
      const id = `cn-${code}-${date}-${String(row.FREE_SHARES_TYPE || "unlock")}`;
      events.set(id, { id, companyId, date, shares: fmt(freeWan), sharesValue: freeWan * 10000, percentTotal: ratio * 100, percentFloat: currentWan > 0 ? Math.min(ableWan / currentWan * 100, 999.99) : 0, estimatedValue: valueWan > 0 ? `≈ ${(valueWan / 10000).toFixed(2)} 亿元` : "未披露", type: String(row.FREE_SHARES_TYPE || "限售股份解禁"), confidence: "已确认", holders: Number(row.BATCH_HOLDER_NUM || 0) > 0 ? `涉及 ${Number(row.BATCH_HOLDER_NUM)} 名股东` : "持有人信息请查看来源公告", source: "东方财富数据中心 · 限售股解禁（交易所公告聚合）", sourceUrl: "https://data.eastmoney.com/dxf/", verifiedAt: String(row.EUTIME || new Date().toISOString()).replace("T", " ").slice(0, 16) });
    }
    console.log(`[A股] ${year}-${String(month).padStart(2, "0")}: ${rows.length}`);
  }
}

const payload = { companies: [...companies.values()], events: [...events.values()].sort((a, b) => a.date.localeCompare(b.date)), generatedAt: new Date().toISOString(), coverage: { CN: `${startYear}-01-01 至 ${endYear}-12-31`, HK: "HKEX 官方文件解析", US: "SEC EDGAR 424B4 解析" } };
await mkdir(new URL("../public/data/", import.meta.url), { recursive: true });
await writeFile(output, `${JSON.stringify(payload)}\n`);
console.log(JSON.stringify({ companies: payload.companies.length, events: payload.events.length, output: output.pathname }, null, 2));
