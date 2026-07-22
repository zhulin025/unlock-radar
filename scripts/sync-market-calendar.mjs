import { mkdir, writeFile } from "node:fs/promises";

const output = new URL("../public/data/market-calendar.json", import.meta.url);
const agent = process.env.MARKET_CALENDAR_USER_AGENT || "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36 UnlockRadar/1.0";
const techSymbols = new Set((process.env.TECH_SYMBOLS || "AAPL,MSFT,NVDA,GOOGL,GOOG,AMZN,META,TSLA,NFLX,INTC,AMD,AVGO,ORCL,CRM,ADBE,QCOM,TXN,MU,KLAC,LRCX,TSM,ASML,SAP,NOW").split(","));
const dayMs = 86400000;

function ymd(date) { return date.toISOString().slice(0, 10); }
function addDays(date, days) { return new Date(date.getTime() + days * dayMs); }
function clean(value) { return String(value || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim(); }
async function get(url) {
  const response = await fetch(url, { headers: { "User-Agent": agent, Accept: "text/html,application/json;q=0.9,*/*;q=0.8", Origin: "https://www.nasdaq.com", Referer: "https://www.nasdaq.com/" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response;
}
function easternOffset(month) { return month >= 3 && month <= 10 ? "-04:00" : "-05:00"; }
function easternToBeijing(year, month, day, time) {
  const match = time.match(/(\d+):(\d+)\s*([ap])\.m\./i);
  if (!match) return { date: `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`, time: undefined };
  let hour = Number(match[1]) % 12 + (match[3].toLowerCase() === "p" ? 12 : 0);
  const instant = new Date(`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}T${String(hour).padStart(2,"0")}:${match[2]}:00${easternOffset(month)}`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Shanghai", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts(instant).map((part) => [part.type, part.value]));
  return { date:`${parts.year}-${parts.month}-${parts.day}`, time:`${parts.hour}:${parts.minute}` };
}

async function syncNasdaq(from, to) {
  const events = [];
  const failures = [];
  const dates = [];
  for (let date = from; date <= to; date = addDays(date, 1)) if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) dates.push(ymd(date));
  for (let cursor = 0; cursor < dates.length; cursor += 5) {
    await Promise.all(dates.slice(cursor, cursor + 5).map(async (date) => {
      const url = `https://api.nasdaq.com/api/calendar/earnings?date=${date}`;
      try {
        const payload = await (await get(url)).json();
        for (const row of payload.data?.rows || []) {
          if (!techSymbols.has(row.symbol)) continue;
          const afterHours = row.time === "time-after-hours";
          const eventDate = afterHours ? ymd(addDays(new Date(`${date}T00:00:00Z`), 1)) : date;
          events.push({ id:`earnings-${row.symbol}-${date}`, date:eventDate, marketDate:date, time:afterHours ? "盘后（次日北京时间）" : row.time === "time-pre-market" ? "盘前" : "时间待公布", title:`${row.symbol} 财报`, kind:"earnings", tickers:row.symbol, companyName:row.name, fiscalQuarter:row.fiscalQuarterEnding, epsForecast:row.epsForecast || null, marketCap:row.marketCap || null, status:"Nasdaq 日历已收录", source:"Nasdaq Earnings Calendar", sourceUrl:`https://www.nasdaq.com/market-activity/stocks/${row.symbol.toLowerCase()}/earnings`, verifiedAt:new Date().toISOString() });
        }
      } catch (error) { failures.push(`${date}: ${error.message}`); }
    }));
  }
  return { events, failures };
}

async function syncFed(months) {
  const events = [];
  const failures = [];
  for (const monthDate of months) {
    const year = monthDate.getUTCFullYear();
    const month = monthDate.getUTCMonth() + 1;
    const monthName = monthDate.toLocaleString("en-US", { month:"long", timeZone:"UTC" }).toLowerCase();
    const url = `https://www.federalreserve.gov/newsevents/${year}-${monthName}.htm`;
    try {
      const html = await (await get(url)).text();
      const panels = [...html.matchAll(/<div class="panel[^>]*>[\s\S]*?<div class="panel-body">([\s\S]*?)<\/div>\s*<\/div>/gi)];
      for (const panel of panels) {
        const body = panel[1];
        const time = clean(body.match(/<div class="col-xs-2">[\s\S]*?<p>(.*?)<\/p>/i)?.[1]);
        const content = body.match(/<div class="col-xs-7">([\s\S]*?)<\/div>/i)?.[1] || "";
        const title = clean(content.match(/<p>(.*?)<\/p>/i)?.[1]);
        const day = Number(clean(body.match(/<div class="col-xs-3">[\s\S]*?<p>(.*?)<\/p>/i)?.[1]));
        if (!day || !/FOMC Minutes|FOMC Meeting|Beige Book|Industrial Production/i.test(title)) continue;
        const beijing = easternToBeijing(year, month, day, time);
        events.push({ id:`fed-${year}-${month}-${day}-${title.toLowerCase().replace(/\W+/g,"-")}`, ...beijing, title:title === "FOMC Meeting" ? "FOMC 利率决议" : title === "FOMC Minutes" ? "FOMC 会议纪要" : title === "Beige Book" ? "美联储褐皮书" : "美国工业产出", kind:/FOMC/.test(title) ? "risk" : "watch", status:"官方日程已核验", source:"Federal Reserve Board", sourceUrl:url, verifiedAt:new Date().toISOString() });
      }
    } catch (error) { failures.push(`${year}-${month}: ${error.message}`); }
  }
  return { events, failures };
}

async function syncBea() {
  const url = "https://www.bea.gov/news/schedule";
  const events = [];
  try {
    const html = await (await get(url)).text();
    for (const row of html.matchAll(/<tr class="scheduled-releases-type-press">([\s\S]*?)<\/tr>/gi)) {
      const body = row[1];
      const dateText = clean(body.match(/<div class="release-date">(.*?)<\/div>/i)?.[1]);
      const timeText = clean(body.match(/<small class="text-muted">(.*?)<\/small>/i)?.[1]);
      const title = clean(body.match(/<td class="release-title[^>]*>([\s\S]*?)<\/td>/i)?.[1]);
      const parsed = new Date(`${dateText}, ${new Date().getUTCFullYear()} ${timeText} GMT-0400`);
      if (!dateText || !title || Number.isNaN(parsed.getTime())) continue;
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Shanghai", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts(parsed).map((part) => [part.type, part.value]));
      events.push({ id:`bea-${parts.year}-${parts.month}-${parts.day}-${title.toLowerCase().replace(/\W+/g,"-")}`, date:`${parts.year}-${parts.month}-${parts.day}`, time:`${parts.hour}:${parts.minute}`, title:/Personal Income and Outlays/i.test(title) ? "个人收入与支出 · PCE" : title.replace(/,.*$/, ""), kind:/GDP|Personal Income/i.test(title) ? "risk" : "macro", detail:title, status:"官方日程已核验", source:"U.S. Bureau of Economic Analysis", sourceUrl:url, verifiedAt:new Date().toISOString() });
    }
    return { events, failures:[] };
  } catch (error) { return { events, failures:[error.message] }; }
}

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")));
const now = new Date();
const from = args.from ? new Date(`${args.from}T00:00:00Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const to = args.to ? new Date(`${args.to}T00:00:00Z`) : addDays(from, 92);
const months = [];
for (let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); cursor <= to; cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))) months.push(cursor);
const [nasdaq, fed, bea] = await Promise.all([syncNasdaq(from, to), syncFed(months), syncBea()]);
const events = [...new Map([...nasdaq.events, ...fed.events, ...bea.events].map((event) => [event.id, event])).values()].sort((a,b) => `${a.date}${a.time || ""}`.localeCompare(`${b.date}${b.time || ""}`));
if (!events.some((event) => event.kind === "earnings")) throw new Error("Validation failed: Nasdaq returned no tracked technology earnings");
if (!events.some((event) => event.source === "Federal Reserve Board") || !events.some((event) => event.source === "U.S. Bureau of Economic Analysis")) throw new Error("Validation failed: official macro sources returned no events");
const payload = { generatedAt:new Date().toISOString(), timezone:"Asia/Shanghai", coverage:{ from:ymd(from), to:ymd(to), sources:["Nasdaq Earnings Calendar","Federal Reserve Board","U.S. Bureau of Economic Analysis"], note:"Only successfully parsed source records are published. BLS is not included because its calendar currently rejects automated requests." }, failures:[...nasdaq.failures, ...fed.failures, ...bea.failures], events };
await mkdir(new URL("../public/data/", import.meta.url), { recursive:true });
await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({ output:output.pathname, events:events.length, earnings:nasdaq.events.length, fed:fed.events.length, bea:bea.events.length, failures:payload.failures.length }, null, 2));
