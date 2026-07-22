import { readFile, writeFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";

const DATA_PATH = new URL("../data/official-events.json", import.meta.url);
const SEC_AGENT = process.env.SEC_USER_AGENT || "UnlockRadar/1.0 zhulin025@users.noreply.github.com";
const DAY_MS = 86400000;

function ymd(date) { return date.toISOString().slice(0, 10); }
function compact(date) { return ymd(date).replaceAll("-", ""); }
function addDays(value, days) { return new Date(new Date(`${value}T00:00:00Z`).getTime() + days * DAY_MS); }
function addMonths(value, months) { const date = new Date(`${value}T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + months); return date; }
function nextWeekday(value) { let date = new Date(`${value}T00:00:00Z`); while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date = addDays(ymd(date), 1); return date; }
function cleanHtml(html) { return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&#8217;|&rsquo;/gi, "’").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/gi, "\"").replace(/\s+/g, " ").trim(); }
function number(value) { return Number(String(value).replaceAll(",", "")); }
function formatShares(shares) { return shares >= 1e8 ? `${(shares / 1e8).toFixed(2)} 亿股` : `${(shares / 1e4).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 万股`; }
function monthNameDate(value) { const date = new Date(`${value}T00:00:00Z`); return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date); }
async function get(url, headers = {}) { const response = await fetch(url, { headers: { "User-Agent": SEC_AGENT, Accept: "*/*", ...headers }, signal: AbortSignal.timeout(30000) }); if (!response.ok) throw new Error(`${response.status} ${url}`); return response; }

async function syncSec(from, to) {
  const companies = [];
  const events = [];
  const quarters = [];
  for (let cursor = new Date(Date.UTC(from.getUTCFullYear(), Math.floor(from.getUTCMonth() / 3) * 3, 1)); cursor <= to; cursor = addMonths(ymd(cursor), 3)) {
    quarters.push([cursor.getUTCFullYear(), Math.floor(cursor.getUTCMonth() / 3) + 1]);
  }
  for (const [year, quarter] of quarters) {
    const indexUrl = `https://www.sec.gov/Archives/edgar/full-index/${year}/QTR${quarter}/master.idx`;
    let indexText;
    try { indexText = await (await get(indexUrl)).text(); } catch { continue; }
    const filings = indexText.split("\n").map((line) => line.trim().split("|")).filter((parts) => parts.length === 5 && parts[2] === "424B4" && parts[3] >= ymd(from) && parts[3] <= ymd(to));
    for (const [cik, companyName, , filedDate, fileName] of filings) {
      try {
        const accession = fileName.split("/").at(-1).replace(".txt", "");
        const accessionBare = accession.replaceAll("-", "");
        const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionBare}`;
        const index = await (await get(`${base}/index.json`)).json();
        const primary = index.directory.item.map((item) => item.name).find((name) => /424b4.*\.html?$/i.test(name)) || index.directory.item.map((item) => item.name).find((name) => /\.html?$/i.test(name) && !name.includes("index"));
        if (!primary) continue;
        const sourceUrl = `${base}/${primary}`;
        const text = cleanHtml(await (await get(sourceUrl)).text());
        const ticker = text.match(/(?:NYSE|Nasdaq[^.]{0,50})\s+(?:under\s+)?the symbol\s+[“\"]?([A-Z][A-Z0-9.]{0,7})/i)?.[1] || text.match(/trading symbol\s+[“\"]?([A-Z][A-Z0-9.]{0,7})/i)?.[1];
        const eligible = text.match(/beginning\s+(\d{2,3})\s+days\s+after\s+the\s+date\s+of\s+this\s+prospectus[\s\S]{0,300}?([\d,]+)\s+additional\s+shares/i);
        const lockup = text.match(/lock[- ]up (?:agreements?|period)[\s\S]{0,500}?(\d{2,3})\s+days?\s+(?:after|from|following)/i)
          || text.match(/for a period of\s+(\d{2,3})\s+days?[\s\S]{0,250}?lock[- ]up/i);
        const lockedShares = text.match(/([\d,]+)\s+shares[^.]{0,180}?(?:subject to|covered by)[^.]{0,80}?lock[- ]up/i)
          || text.match(/lock[- ]up[^.]{0,180}?([\d,]+)\s+shares/i);
        if (!ticker || (!eligible && !lockup)) continue;
        const periodDays = Number(eligible?.[1] || lockup?.[1]);
        const shares = number(eligible?.[2] || lockedShares?.[1] || 0);
        if (!periodDays || !shares) continue;
        const filed = filedDate.includes("-") ? filedDate : `${filedDate.slice(0, 4)}-${filedDate.slice(4, 6)}-${filedDate.slice(6, 8)}`;
        const prospectusTextDate = text.slice(0, 18000).match(/prospectus dated\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i)?.[1];
        const baseDate = prospectusTextDate ? ymd(new Date(`${prospectusTextDate} UTC`)) : filed;
        const eventDate = ymd(nextWeekday(ymd(addDays(baseDate, periodDays))));
        const id = `us-${ticker}`;
        const conditional = /earlier terminated|early release|may release.*lock-up/i.test(text);
        companies.push({ id, market: "US", symbol: ticker, name: companyName, fullName: companyName, exchange: /NYSE/i.test(text.slice(0, 25000)) ? "NYSE" : "NASDAQ", industry: "美国上市公司", description: "公司资料来自 SEC IPO 申报文件。", totalShares: "未披露", floatShares: "未披露" });
        events.push({ id: `${id}-${eventDate}-ipo-lockup`, companyId: id, date: eventDate, shares: formatShares(shares), sharesValue: shares, percentTotal: 0, percentFloat: 0, estimatedValue: "未披露", type: "IPO lock-up / shares eligible for future sale", confidence: conditional ? "条件性事件" : "按条款推算", holders: "IPO 前股东、董事及管理层（以 filing 披露为准）", source: `SEC 424B4 · ${periodDays} 天 lock-up 条款`, sourceUrl, verifiedAt: new Date().toISOString().slice(0, 16).replace("T", " ") });
      } catch (error) { console.warn(`[SEC] skip ${companyName}: ${error.message}`); }
    }
  }
  return { companies, events };
}

async function pdfText(url) { const bytes = new Uint8Array(await (await get(url, { Referer: "https://www1.hkexnews.hk/" })).arrayBuffer()); const parser = new PDFParse({ data: bytes }); try { return (await parser.getText()).text.replace(/\s+/g, " "); } finally { await parser.destroy(); } }

async function syncHkex(from, to) {
  const companies = [];
  const events = [];
  for (let cursor = new Date(from); cursor <= to; cursor = addDays(ymd(cursor), 7)) {
    const chunkEnd = new Date(Math.min(to.getTime(), addDays(ymd(cursor), 6).getTime()));
    const params = new URLSearchParams({ sortDir: "0", sortByOptions: "DateTime", category: "0", market: "SEHK", stockId: "-1", documentType: "-1", fromDate: compact(cursor), toDate: compact(chunkEnd), title: "", searchType: "0", t1code: "-2", t2Gcode: "-2", t2code: "-2", rowRange: "5000", lang: "EN" });
    let rows;
    try { const payload = await (await get(`https://www1.hkexnews.hk/search/titleSearchServlet.do?${params}`, { Referer: "https://www1.hkexnews.hk/search/titlesearch.xhtml", "X-Requested-With": "XMLHttpRequest" })).json(); rows = typeof payload.result === "string" ? JSON.parse(payload.result) : payload.result; if (!Array.isArray(rows)) rows = []; } catch { continue; }
    const candidates = rows.filter((row) => /allotment results|results of allocations|lock-up undertaking|lock-up period/i.test(`${row.TITLE} ${row.SHORT_TEXT}`));
    for (const row of candidates) {
      const sourceUrl = row.FILE_LINK.startsWith("http") ? row.FILE_LINK : `https://www1.hkexnews.hk${row.FILE_LINK}`;
      try {
        const text = await pdfText(sourceUrl);
        const endMatch = text.match(/required lock-up (?:periods? )?(?:will )?end(?:s)? on\s+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i);
        const listingMatch = text.match(/(?:dealings in the H Shares|listing) (?:are expected to )?(?:commence|take place) on\s+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i);
        const monthsMatch = text.match(/lock-up period of\s+(six|twelve|\d+)\s+months?/i);
        if (!endMatch && !(listingMatch && monthsMatch)) continue;
        const cornerstoneStart = text.search(/Cornerstone Investors/i);
        const segment = cornerstoneStart >= 0 ? text.slice(cornerstoneStart, cornerstoneStart + 18000) : text;
        const totalMatch = segment.match(/Total\s+([\d,]+)(?:\s+H Shares)?\s+(?:[\d.]+%\s+)?([\d.]+)%/i);
        if (!totalMatch) continue;
        const shares = number(totalMatch[1]);
        const percentTotal = Number(totalMatch[2]);
        const listingDate = listingMatch ? ymd(new Date(`${listingMatch[1]} UTC`)) : null;
        const months = monthsMatch ? ({ six: 6, twelve: 12 }[monthsMatch[1].toLowerCase()] || Number(monthsMatch[1])) : 0;
        const lockupEnd = endMatch ? ymd(new Date(`${endMatch[1].replace(/(\d),\s+(\d{4})/, "$1, $2")} UTC`)) : ymd(addDays(ymd(addMonths(listingDate, months)), -1));
        const eventDate = ymd(nextWeekday(ymd(addDays(lockupEnd, 1))));
        const symbol = String(row.STOCK_CODE || "").padStart(5, "0");
        const id = `hk-${symbol}`;
        const name = String(row.STOCK_NAME || symbol).replace(/<[^>]+>/g, " ").trim();
        companies.push({ id, market: "HK", symbol, name, fullName: name, exchange: "香港联合交易所 · 主板", industry: "香港上市公司", description: "公司资料来自 HKEXnews 上市及配发文件。", totalShares: "未披露", floatShares: "未披露" });
        events.push({ id: `${id}-${eventDate}-cornerstone`, companyId: id, date: eventDate, shares: formatShares(shares), sharesValue: shares, percentTotal, percentFloat: 0, estimatedValue: "未披露", type: "基石投资者锁定期届满", confidence: "已确认", holders: "基石投资者（以配发结果公告为准）", source: `HKEXnews · 锁定期最后一日 ${monthNameDate(lockupEnd)}`, sourceUrl, verifiedAt: new Date().toISOString().slice(0, 16).replace("T", " ") });
      } catch (error) { console.warn(`[HKEX] skip ${row.STOCK_CODE}: ${error.message}`); }
    }
  }
  return { companies, events };
}

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")));
const to = new Date(`${args.to || ymd(new Date())}T00:00:00Z`);
const from = new Date(`${args.from || ymd(addDays(ymd(to), -7))}T00:00:00Z`);
const existing = JSON.parse(await readFile(DATA_PATH, "utf8"));
const [sec, hkex] = await Promise.all([syncSec(from, to), syncHkex(from, to)]);
const companies = [...new Map([...existing.companies, ...sec.companies, ...hkex.companies].map((item) => [item.id, item])).values()];
const events = [...new Map([...existing.events, ...sec.events, ...hkex.events].map((item) => [item.id, item])).values()].sort((a, b) => a.date.localeCompare(b.date));
await writeFile(DATA_PATH, `${JSON.stringify({ companies, events, generatedAt: new Date().toISOString(), note: "Automated SEC/HKEX discovery with strict publish-only-when-parseable validation." }, null, 2)}\n`);
console.log(JSON.stringify({ from: ymd(from), to: ymd(to), sec: sec.events.length, hkex: hkex.events.length, total: events.length }, null, 2));
