---
title: ClickHouse 系列：SummingMergeTree 進行資料彙總的應用場景
published: 2025-08-09
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, 鐵人賽]
category: 'software development'
draft: false 
lang: ''
---

有一天你工作工作，在當社畜的時候，發現你現在需要大量的「數值加總」、「分組彙總統計」，例如每日活躍使用者數量、每小時流量統計、即時計數器 (Counter) 等，ClickHouse 提供了一個極致高效的資料彙總利器 —— **SummingMergeTree**。

## SummingMergeTree 是什麼？

SummingMergeTree 是 ClickHouse MergeTree 系列的引擎變種，具備在資料合併 (Merge) 階段，自動將具有相同 `Primary Key` 的數值欄位進行加總 (SUM)，幫助你快速構建高效能的預彙總表 (Pre-Aggregated Table)。

### 特點：

* **自動數值欄位加總**：相同 Primary Key 的記錄在 Merge 時會自動執行加總。
* **非即時性彙總**：數值加總發生於背景 Merge 階段。
* **無需寫聚合函數邏輯**，簡單定義即可。


## SummingMergeTree 的語法與範例

```sql
CREATE TABLE daily_metrics
(
    date Date,
    page String,
    views UInt32,
    clicks UInt32
) ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (date, page);
```

* 所有 **數值型欄位 (Numeric Types)** 預設皆會參與加總。
* 字串欄位僅參與 GROUP BY，不會被彙總。

```sql
INSERT INTO daily_metrics VALUES ('2025-08-01', 'Home', 100, 10);
INSERT INTO daily_metrics VALUES ('2025-08-01', 'Home', 200, 25);
INSERT INTO daily_metrics VALUES ('2025-08-01', 'Contact', 50, 5);
```

查詢時仍會看到所有資料：

```sql
SELECT * FROM daily_metrics WHERE date = '2025-08-01';
```

| date       | page    | views | clicks |
| ---------- | ------- | ----- | ------ |
| 2025-08-01 | Home    | 100   | 10     |
| 2025-08-01 | Home    | 200   | 25     |
| 2025-08-01 | Contact | 50    | 5      |

進行背景 Merge（或強制 Optimize）後：

```sql
OPTIMIZE TABLE daily_metrics FINAL;
```

再查詢結果：

| date       | page    | views | clicks |
| ---------- | ------- | ----- | ------ |
| 2025-08-01 | Home    | 300   | 35     |
| 2025-08-01 | Contact | 50    | 5      |


## 應用場景

| 場景                                  | 說明                                                               |
| ----------------------------------- | ---------------------------------------------------------------- |
| **即時計數器 (Counter)** | 用於 API Call 次數、商品瀏覽次數等累加統計場景。                                    |
| **批次數據預彙總 (Batch Aggregation)**     | 將大數據表做成 Pre-Aggregated Table，避免即時計算壓力。                           |
| **流量/活動數據彙總 (Metrics Aggregation)** | 日誌、網站流量統計、使用者行為統計（例如 PV/UV 指標）。                                   |
| **與 Materialized View 搭配**          | 將 Raw Data 資料流寫入 Materialized View，實時聚合彙總結果至 SummingMergeTree 表。 |


## GROUP BY 規則

SummingMergeTree 的去重與彙總邏輯是以 **Primary Key 欄位為基準**，並對數值欄位進行加總。

* ORDER BY 欄位 = GROUP BY Key
* 數值型欄位 (Int, Float) 才會自動 SUM
* 字串、日期等欄位僅參與分組，不會被聚合

若 `Primary Key` 欄位設計錯誤（例如太細緻或包含非必要欄位），將導致彙總效果失效，無法正確合併統計數據。


## 進階：Materialized View 實時聚合

```sql
CREATE TABLE raw_events
(
    event_time DateTime,
    page String,
    views UInt32,
    clicks UInt32
) ENGINE = MergeTree
ORDER BY (event_time, page);

CREATE MATERIALIZED VIEW mv_daily_metrics
TO daily_metrics
AS SELECT
    toDate(event_time) AS date,
    page,
    sum(views) AS views,
    sum(clicks) AS clicks
FROM raw_events
GROUP BY date, page;
```

這樣每次寫入 `raw_events` 時，ClickHouse 會即時計算彙總結果並寫入 `daily_metrics (SummingMergeTree)`。


## SummingMergeTree 與 AggregatingMergeTree 差異

| 特性      | SummingMergeTree | AggregatingMergeTree                               |
| ------- | ---------------- | -------------------------------------------------- |
| 支援的聚合函數 | 只支援 SUM（數值欄位）    | 支援所有 AggregateFunction (SUM, AVG, COUNT, MIN, MAX) |
| 聚合邏輯    | 背景 Merge 時加總     | 需配合 AggregateFunction 資料型別與聚合函數進行計算                |
| 設計複雜度   | 簡單 (適用於計數器、單純加總) | 較複雜，適用於指標統計、分位數、去重統計等                              |
| 寫入性能    | 較高（無需特殊型別）       | 較低（需轉換為 AggregateFunction 型別資料寫入）                  |


## 最佳實踐與注意事項

1. **Primary Key 設計決定彙總效果**：`ORDER BY` 需謹慎設計，只包含用來 `GROUP BY` 的欄位。
2. **數值欄位命名避免衝突**：非數值欄位不會被加總，但欄位型別設錯或命名混亂會導致統計錯誤。
3. **資料寫入順序不影響結果**：Merge 階段才會進行彙總，因此資料流式寫入無需排序。
4. **定期執行 OPTIMIZE FINAL**：若查詢即時性要求高，可定期強制執行合併去重，確保查詢返回彙總後的結果。
5. **Materialized View 為即時彙總最佳搭配**：用以將原始大表流量，實時寫入 `SummingMergeTree` 進行高效查詢。

## 結語

SummingMergeTree 提供了一種簡單卻強大的數據彙總方式，非常適合用於統計計數、流量指標分析與預彙總表場景。透過合理設計 Primary Key 與 Materialized View 的搭配，能讓你的查詢效能成倍提升。

### ClickHouse 系列持續更新中:

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
25. [ClickHouse 系列：APM 日誌分析平台架構實作 (Vector + ClickHouse)](https://blog.vicwen.app/posts/clickhouse-apm-log-analytics/)
26. [ClickHouse 系列：IoT 巨量感測數據平台設計實戰](https://blog.vicwen.app/posts/clickhouse-iot-analytics/)
27. [ClickHouse 系列：與 BI 工具整合（Power BI）](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
28. [ClickHouse 系列：ClickHouse Cloud 與自建部署的優劣比較](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
29. [ClickHouse 系列：資料庫安全性與權限管理（RBAC）實作](https://blog.vicwen.app/posts/clickhouse-security-rbac/)

