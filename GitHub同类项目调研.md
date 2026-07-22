# GitHub 同类项目调研与复用决策

> 调研日期：2026-07-22  
> 项目：A 股、港股、美股公司解禁月历  
> 结论：没有找到可直接改造成目标产品的完整开源网站；采用“自研产品前端 + 复用成熟数据能力”的组合方案。

## 1. 检索范围

检索关键词覆盖：

- `股票 解禁 日历 限售股 上市流通`
- `A股 限售股 解禁 数据`
- `IPO lockup expiration calendar`
- `stock unlock calendar Hong Kong US`
- `HKEX announcements scraper`
- `SEC EDGAR parser`
- `stock calendar Next.js`

评估维度：功能匹配度、技术栈、最近维护时间、许可证、可复用模块、数据来源和采用风险。

## 2. 候选项目比较

| 项目 | 相关能力 | 维护与许可证 | 匹配结论 | 决策 |
|---|---|---|---|---|
| [akfamily/akshare](https://github.com/akfamily/akshare) | A 股限售股解禁汇总、详情、批次、股东等 Python 接口 | 活跃；MIT | A 股数据能力高度相关，但不是网站，也不解决港美股口径 | 后端阶段优先验证接口与字段；不复制前端 |
| [simonlin1212/a-stock-data](https://github.com/simonlin1212/a-stock-data) | A 股解禁日历、公司信息、总股本和流通股等直连数据思路 | 活跃；Apache-2.0 | 字段与本项目高度匹配，并包含限流和备用源经验 | 参考其数据字段、降级与节流策略；正式使用前核对上游数据条款 |
| [zhewenzhang/tushare_MCP](https://github.com/zhewenzhang/tushare_MCP) | Tushare `share_float` 解禁数据封装 | 有维护；MIT | 数据结构合适，但依赖 Tushare token 和积分权限 | 作为 A 股付费/授权数据备选，不作为零配置首版依赖 |
| [AlexLiue/tushare_sync](https://github.com/AlexLiue/tushare_sync) | 将 Tushare `share_float` 等表同步到本地数据库 | 维护较旧；无明确许可证 | 同步架构可参考，但授权不明 | 不复制代码，只参考表同步思路 |
| [jjh0796-svg/ipo-lockup-calendar](https://github.com/jjh0796-svg/ipo-lockup-calendar) | IPO 锁定期日历、JSON/ICS 产物、到期日顺延 | 新仓库；无明确许可证 | 名称最接近，但只覆盖韩国 IPO，不含网站和三地数据 | 不复制代码；仅参考“原始到期日 + 可交易日”双日期设计 |
| [Benzinga/benzinga-python-client](https://github.com/Benzinga/benzinga-python-client) | 美股 IPO 数据包含 `insider_lockup_days/date` | 有维护；MIT；数据 API 商业化 | 美股标准 IPO lock-up 字段直接匹配，但数据服务可能收费 | 作为美股结构化供应商候选，不在本地演示版绑定密钥 |
| [dgunning/edgartools](https://github.com/dgunning/edgartools) | SEC EDGAR 文件下载、解析和结构化访问 | 活跃；MIT | 适合获取 S-1/F-1/424B/8-K 等原始文件，但不直接生成解禁事件 | 美股后端首选基础库；在其上构建 lock-up 条款规则引擎 |
| [jadchaar/sec-edgar-downloader](https://github.com/jadchaar/sec-edgar-downloader) | 按公司和表单下载 SEC 文件 | 活跃；MIT | 下载稳定但解析能力少于 edgartools | 作为 edgartools 下载异常时的轻量备选 |
| [skxox/hkex-announcement-sync](https://github.com/skxox/hkex-announcement-sync) | 同步 HKEXnews 公司公告 | 规模小；MIT | 可借鉴公告增量同步，但没有锁定条款解析 | 港股采集阶段单独验证；不直接引入首版前端 |
| [alpenmilch411/filings-fetcher](https://github.com/alpenmilch411/filings-fetcher) | SEC、HKEX 等一手披露文件获取 | 新且规模小；MIT | 多市场文件入口与本项目相符，但成熟度有限 | 用真实样本评估后再决定是否复用 |
| [gerrymanoim/exchange_calendars](https://github.com/gerrymanoim/exchange_calendars) | 50+ 交易所的交易日和休市日，包括上交所、港交所、纽交所 | 活跃；Apache-2.0 | 非解禁数据，但可解决时区、休市和顺延计算 | 数据后端阶段直接复用，避免自行维护交易日表 |
| [fullcalendar/fullcalendar](https://github.com/fullcalendar/fullcalendar) | 成熟的 JavaScript 日历组件 | 活跃；MIT | 偏会议事件与拖拽排期；金融月历单元格信息结构需大量改造 | 不引入；自研轻量月历网格，减少体积和样式冲突 |

## 3. 实际复用方案

### 当前前端版本

- 不整体复制任何候选网站。
- 月历网格、搜索、收藏公司列表和事件详情按本项目交互自研。
- 数据层设计沿用候选项目中已验证的核心字段：解禁日期、解禁数量、占总股本比例、股东、股份类型、来源。
- 收藏使用浏览器本地存储，不引入外部依赖。
- 演示数据统一标注，不能伪装成实时金融数据。

### 后端数据阶段

1. A 股优先用 AKShare 做接口可用性验证，同时参考 a-stock-data 的直连、限流与备用源策略。
2. 如果产品进入稳定运营或商业化，评估 Tushare 或持牌数据供应商，避免依赖无再分发授权的页面接口。
3. 美股使用 edgartools 获取 SEC 原始文件，自研 lock-up 条款抽取和状态分级。
4. 港股用 HKEXnews 原始披露建立增量采集；小型抓取仓库只作为工程参考，先做稳定性测试。
5. 三地交易日、休市和顺延计算使用 exchange_calendars。

## 4. 明确不复用的内容

- 无许可证仓库的代码、JSON 数据和样式。
- 只根据“上市日 + 固定天数”计算所有港美股解禁日期的简化逻辑。
- FullCalendar 的事件模型和拖拽交互。
- 未确认展示与再分发授权的第三方财经接口数据。
- 韩国 IPO lockup 项目的具体数据，因为市场、规则和目标范围均不相同。

## 5. 对当前开发的影响

- 前端继续采用现有 Next.js/TypeScript 项目骨架，自研产品界面。
- 预留统一数据适配层，未来可将演示数据替换为 AKShare、Tushare、SEC/HKEX 解析结果。
- 事件模型增加 `source`、`status`、`confidence`、`rawExpiryDate` 和 `tradableDate` 等可追溯字段。
- 首版优先交付可运行的完整产品体验，不把尚未接入的数据能力假装成实时服务。

## 6. 许可证处理

- MIT/Apache-2.0 依赖正式引入时，在项目中保留其许可证和必要声明。
- 当前阶段没有直接复制上述仓库代码，因此无需加入第三方源码声明。
- 后续每次新增外部代码或数据依赖，都需在提交前补充来源、版本、许可证和用途。
