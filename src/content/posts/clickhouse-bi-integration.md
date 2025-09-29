---
title: ClickHouse 系列：與 BI 工具整合（Power BI）
published: 2025-08-29
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, 鐵人賽, Distributed]
category: 'software development'
draft: false 
lang: ''
---

在企業數據分析場景中，BI（Business Intelligence）工具是將資料轉化為商業決策的重要橋樑。ClickHouse 雖然提供強大的查詢與聚合能力，但若要將分析結果可視化並提供互動式操作，整合 BI 工具是必經之路。

常見與 ClickHouse 整合的 BI 工具有：

* **Metabase**：開源、易用，適合中小型團隊快速部署
* **Apache Superset**：開源、可高度自訂，支援多種資料來源
* **Power BI**：微軟旗艦級 BI 工具，整合度高、可與 Excel/Office 365 深度連動

本篇將以 **Power BI** 為例，示範如何將 ClickHouse 資料導入並進行可視化分析。

## 為什麼選擇 Power BI 與 ClickHouse 整合

Power BI 在企業端有以下優勢：

1. **與 Microsoft 生態系統整合**（Excel、Teams、Azure 等）
2. **即時儀表板更新**，適合搭配 ClickHouse 高效查詢能力
3. **易於分享與權限控管**（支援 AD、RBAC）
4. **支援 DirectQuery / Import 模式**

## 整合步驟：Power BI 連接 ClickHouse

### 1. 安裝 ClickHouse ODBC Driver

Power BI 目前無原生 ClickHouse 連接器，因此需使用 **ODBC Driver**。

安裝方式（以 Windows 為例）：

1. 前往 ClickHouse 官方下載頁
   [https://github.com/ClickHouse/clickhouse-odbc/releases](https://github.com/ClickHouse/clickhouse-odbc/releases)
2. 下載對應系統版本（建議 64-bit 與 Power BI Desktop 相容的版本）
3. 安裝完成後，在 ODBC Data Source Administrator 中新增 DSN：

   * Driver：ClickHouse ODBC Unicode
   * Server：`<ClickHouse Host>`
   * Port：`8123`
   * Database：`default`
   * User：`default`
   * Password：`default`

### 2. 在 Power BI 中新增資料來源

1. 開啟 **Power BI Desktop**
2. 點擊 **取得資料 (Get Data)**
3. 搜尋並選擇 **ODBC**
4. 選擇剛才設定的 **ClickHouse DSN**
5. 輸入 ClickHouse SQL 查詢（或直接選擇資料表）

範例查詢：

```sql
SELECT
    toStartOfDay(EventDate) AS day,
    Action,
    count() AS action_count
FROM user_events
GROUP BY day, Action
ORDER BY day ASC;
```

### 3. 設定匯入模式

Power BI 提供兩種模式連接 ClickHouse：

| 模式              | 特點                                                | 適用情境          |
| --------------- | ------------------------------------------------- | ------------- |
| **Import**      | 將資料匯入 Power BI，本地快取，查詢速度快但需手動/排程更新                | 靜態報表、每日或每小時更新 |
| **DirectQuery** | 每次查詢時即時連到 ClickHouse，保證最新資料，但效能依賴 ClickHouse 查詢速度 | 即時監控、低延遲需求    |

在即時監控場景下，建議使用 **DirectQuery** 模式，充分發揮 ClickHouse 高速查詢的優勢。

### 4. 建立可視化圖表

在 Power BI 中可建立多種圖表類型：

* **折線圖 (Line chart)**：每日事件數變化
* **圓餅圖 (Pie chart)**：Action 類型比例
* **堆疊直條圖 (Stacked column chart)**：不同操作在不同日期的分佈
* **卡片 (Card)**：關鍵指標（如今日事件數、活躍用戶數）

範例儀表板：

| 面板名稱        | 說明                |
| ----------- | ----------------- |
| **每日事件數趨勢** | 折線圖顯示每日總事件數       |
| **操作類型比例**  | 圓餅圖顯示各 Action 百分比 |
| **用戶活躍分佈**  | 長條圖顯示不同用戶的事件數量排名  |

## 效能優化建議

| 策略                       | 說明                              |
| ------------------------ | ------------------------------- |
| 使用 Materialized View 彙總表 | 將複雜聚合預先計算後供 Power BI 查詢，避免掃描大表  |
| 採用 Partition Key         | 在 ClickHouse 中對日期或業務維度分區，減少掃描範圍 |
| 選擇 DirectQuery + 高效 SQL  | 確保 Power BI 查詢即時響應              |
| 減少資料列數量                  | 使用 `LIMIT`、`WHERE` 過濾不必要的歷史資料   |

## 與其他 BI 工具比較

| 工具           | 特點                           | 適用場景        |
| ------------ | ---------------------------- | ----------- |
| **Metabase** | 安裝簡單、開源免費、支援 SQL & GUI Query | 中小型團隊快速部署   |
| **Superset** | 開源、支援多資料源、可高度自訂              | 技術團隊需要靈活擴展  |
| **Power BI** | 商業級 BI、與 Microsoft 生態整合      | 企業級報表與跨部門協作 |

## 總結

透過 ODBC 連接，ClickHouse 可以與 Power BI 無縫整合，並結合其可視化與分享能力，打造高效、即時的商業分析平台。

在即時分析場景下，建議採用 **DirectQuery** 搭配 ClickHouse 的 Materialized View，既能保證資料新鮮度，又能降低查詢負載。

#### ClickHouse 系列持續更新中:

1. [ClickHouse 系列：ClickHouse 是什麼？與傳統 OLAP/OLTP 資料庫的差異](https://blog.vicwen.app/posts/what-is-clickhouse/)
2. [ClickHouse 系列：ClickHouse 為什麼選擇 Column-based 儲存？講解 Row-based 與 Column-based 的核心差異](https://blog.vicwen.app/posts/clickhouse-column-row-based-storage/)
3. [ClickHouse 系列：ClickHouse 儲存引擎 - MergeTree](https://blog.vicwen.app/posts/clickhouse-mergetree-engine)
4. [ClickHouse 系列：壓縮技術與 Data Skipping Indexes 如何大幅加速查詢](https://blog.vicwen.app/posts/clickhouse-compression-skipping-index/)
5. [ClickHouse 系列：ReplacingMergeTree 與資料去重機制](https://blog.vicwen.app/posts/clickhouse-replacingmergetree-deduplication/)
6. [ClickHouse 系列：SummingMergeTree 進行資料彙總的應用場景](https://blog.vicwen.app/posts/clickhouse-summingmergetree-aggregation/)
7. [ClickHouse 系列：Materialized Views 即時聚合查詢](https://blog.vicwen.app/posts/clickhouse-materialized-view/)
8. [ClickHouse 系列：分區策略與 Partition Pruning 原理解析](https://blog.vicwen.app/posts/clickhouse-partition-pruning/)
9. [ClickHouse 系列：Primary Key、Sorting Key 與 Granule 索引運作原理](https://blog.vicwen.app/posts/clickhouse-primary-sorting-key/)
10. [ClickHouse 系列：CollapsingMergeTree 與邏輯刪除的最佳實踐](https://blog.vicwen.app/posts/clickhouse-collapsingmergetree/)
11. [ClickHouse 系列：VersionedCollapsingMergeTree 版本控制與資料衝突解決](https://blog.vicwen.app/posts/clickhouse-versioned-collapsingmergetree/)
12. [ClickHouse 系列：AggregatingMergeTree 實時指標統計的進階應用](https://blog.vicwen.app/posts/clickhouse-aggregatingmergetree/)
13. [ClickHouse 系列：Distributed Table 與分布式查詢架構](https://blog.vicwen.app/posts/clickhouse-distributed-table-architecture/)
14. [ClickHouse 系列：Replicated Tables 高可用性與零停機升級實作](https://blog.vicwen.app/posts/clickhouse-replication-failover/)
15. [ClickHouse 系列：與 Kafka 整合打造即時 Data Streaming Pipeline](https://blog.vicwen.app/posts/clickhouse-kafka-data-streaming-pipeline/)
16. [ClickHouse 系列：批次匯入最佳實踐 (CSV、Parquet、Native Format)](https://blog.vicwen.app/posts/clickhouse-batch-import/)
17. [ClickHouse 系列：ClickHouse 與外部資料源整合（PostgreSQL）](https://blog.vicwen.app/posts/clickhouse-external-data-integration/)
18. [ClickHouse 系列：如何提升查詢優化？system.query_log 與 EXPLAIN 用法](https://blog.vicwen.app/posts/clickhouse-query-log-explain/)
19. [ClickHouse 系列：Projections 進階查詢加速技術](https://blog.vicwen.app/posts/clickhouse-projections-optimization/)
20. [ClickHouse 系列：Sampling 抽樣查詢與統計技術原理](https://blog.vicwen.app/posts/clickhouse-sampling-statistics/)
21. [ClickHouse 系列：TTL 資料清理與儲存成本優化](https://blog.vicwen.app/posts/clickhouse-ttl-storage-management/)
22. [ClickHouse 系列：儲存政策（Storage Policies）與磁碟資源分層策略](https://blog.vicwen.app/posts/clickhouse-storage-policies/)
23. [ClickHouse 系列：表格設計與儲存優化細節](https://blog.vicwen.app/posts/clickhouse-schemas-storage-improvement/)
24. [ClickHouse 系列：ClickHouse 系列：整合 Grafana 打造可視化監控](https://blog.vicwen.app/posts/clickhouse-grafana-dashboard/)
25. [ClickHouse 系列：查詢優化案例](https://blog.vicwen.app/posts/clickhouse-select-optimization/)
26. [ClickHouse 系列：與 BI 工具整合（Power BI）](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
27. [ClickHouse 系列：ClickHouse Cloud 與自建部署的優劣比較](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
28. [ClickHouse 系列：資料庫安全性與權限管理（RBAC）實作](https://blog.vicwen.app/posts/clickhouse-security-rbac/)
29. [ClickHouse 系列：Kubernetes 部署分散式架構](https://blog.vicwen.app/posts/clickhouse-operator-kubernates/)
30. [ClickHouse 系列：從原始碼看 MergeTree 的六大核心機制](https://blog.vicwen.app/posts/clickhouse-mergetree-sourcecode-introduction/)