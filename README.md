# 解禁雷达（Unlock Radar）

A 股、港股与美股公司的限售股解禁及锁定期到期月历。

## 数据架构

- A 股：公开交易所公告聚合接口，Actions 预生成过去 3 年至未来 2 年的数据。
- 港股：解析 HKEXnews 配发结果、基石投资者及 lock-up 披露。
- 美股：解析 SEC EDGAR 424B4 的 IPO lock-up / shares eligible for future sale 条款。
- `data/official-events.json` 保存经解析的港美事件；`public/data/calendar.json` 是网页读取的完整静态数据集。
- `public/data/market-calendar.json` 由自动脚本生成，包含 Nasdaq 重点科技股财报、Federal Reserve 央行事件与 BEA 宏观发布日程，统一转换为北京时间。
- 解禁只表示股份取得流通资格，不表示股东实际减持。

## 本地运行

```bash
npm ci
npm run data:build
npm run market:sync
npm run dev
```

静态 Pages 构建：

```bash
npm run build:pages
```

## 自动同步

- `Sync global unlock data`：工作日每日同步最近 7 天 HKEX 与 SEC 文件并提交有效数据。
- `Build data and deploy GitHub Pages`：数据同步或主分支更新后，生成 A 股数据、构建静态网站并发布 Pages。
- `Sync macro and earnings calendar`：每日抓取 Nasdaq、Federal Reserve 和 BEA，校验静态构建后提交变化；提交会触发 Pages 构建。BLS 因官方站当前拒绝自动请求，暂不纳入自动数据，避免用参考数据冒充真实数据。
- 港美历史回填可在 Actions 手动运行同步工作流，并填写 `from`、`to`；建议按月分段。

SEC 自动访问使用可识别的 User-Agent；如需替换联系方式，可配置仓库 Secret `SEC_USER_AGENT`。
