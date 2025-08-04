---
title: ClickHouse 系列：Materialized Views 即時聚合查詢
published: 2025-08-10
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database]
category: 'software development'
draft: false 
lang: ''
---

在 OLAP 系統中，「即時聚合」與「預先計算」是加速查詢、降低資源消耗的核心策略。ClickHouse 提供了強大的 **Materialized Views (物化視圖)**，能將複雜查詢結果實時寫入表中，並大幅減輕查詢時的運算壓力。


## 什麼是 Materialized View？

Materialized View 是一種 **帶有持久化儲存結果的查詢視圖**，當有資料寫入源表 (source table) 時，ClickHouse 會自動根據定義的 SELECT 查詢語句計算並將結果寫入目標表 (target table)。

簡單來說，它就是一種「**自動觸發的 Insert + 聚合查詢 + 寫入彙總表**」的機制。

### 特點：

* INSERT 寫入源表時，自動將計算結果寫入目標表。
* 目標表通常是 `SummingMergeTree` / `AggregatingMergeTree` 等。
* 只會計算「新寫入資料」的查詢結果，不會對舊資料重新掃描。


## 基本語法與範例

### 1. 建立 Source Table (Raw Data Table)

```sql
CREATE TABLE events
(
    event_time DateTime,
    page String,
    user_id UInt64,
    views UInt32
) ENGINE = MergeTree
ORDER BY (event_time, page);
```

### 2. 建立 Target Table (Aggregate Table)

```sql
CREATE TABLE daily_page_views
(
    date Date,
    page String,
    total_views UInt32
) ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (date, page);
```

### 3. 建立 Materialized View

```sql
CREATE MATERIALIZED VIEW mv_daily_page_views
TO daily_page_views
AS SELECT
    toDate(event_time) AS date,
    page,
    sum(views) AS total_views
FROM events
GROUP BY date, page;
```

每當資料寫入 `events` 表時，ClickHouse 會自動計算每天每頁面的瀏覽量，並寫入 `daily_page_views` 表中。


## 運作流程

1. INSERT → `events`
2. Materialized View 觸發 SELECT + 聚合運算
3. 將結果 INSERT 進 `daily_page_views`
4. 查詢 `daily_page_views` 時直接取用彙總結果


## 應用場景

| 應用場景                                         | 說明                                       |
| -------------------------------------------- | ---------------------------------------- |
| **高頻查詢彙總結果表 (Dashboard/BI 報表)**              | 先將重計算的聚合結果寫入目標表，查詢時僅需掃小型表格               |
| **即時Event Streaming彙總 (如 PV/UV 統計)**                     | 結合 Kafka + MV，即時統計點擊數、瀏覽量等               |
| **指標統計與彙總 (Metrics Storage)**                | 以 Materialized View 實時計算指標數據，適合 IoT、監控平台 |
| **ReplacingMergeTree 或 SummingMergeTree 結合** | 目標表可以使用去重、聚合引擎進一步優化結果儲存                  |


## Materialized View 設計重點與限制

### 1. **目標表 (TO Table) 必須先存在**

Materialized View 是寫入目標表的「Trigger」，Target Table 必須先建立好。

### 2. **只計算新增資料**

MV 只會針對「新寫入」的資料進行聚合，不會針對舊資料補算，若源表有歷史資料變動需手動重算。

### 3. **INSERT 觸發查詢，查詢性能依賴目標表設計**

目標表應搭配適當的 MergeTree 引擎（`Summing`, `Aggregating`, `Replacing`）來對應資料處理需求。

### 4. **無法直接支援 UPDATE/DELETE**

MV 只會針對 INSERT 事件觸發，若需進行補數據、資料刪除，需配合 `ReplacingMergeTree` 或 Mutation 處理。


## 進階：POPULATE 一次性計算歷史資料

若 Materialized View 建立時希望自動將源表的歷史資料也計算入目標表，可以使用 `POPULATE` 關鍵字。

```sql
CREATE MATERIALIZED VIEW mv_daily_page_views POPULATE
TO daily_page_views
AS SELECT
    toDate(event_time) AS date,
    page,
    sum(views) AS total_views
FROM events
GROUP BY date, page;
```

### 注意：

* POPULATE 只在建立時執行一次，之後不再作用。
* 若源表有新歷史資料寫入，需要自行做補數據操作。


## Materialized View vs View vs LIVE View 差異

| 類型                    | 說明                                  | 主要用途                       |
| --------------------- | ----------------------------------- | -------------------------- |
| **Materialized View** | INSERT 時將查詢結果實體化寫入表                 | 即時聚合、數據彙總                  |
| **View (普通 View)**    | 查詢時執行 SELECT，無數據儲存                  | 簡化複雜查詢語法                   |
| **LIVE View**         | 基於資料更新自動推送查詢結果 (類似 Streaming Query) | 即時查詢動態數據（但性能較重，不建議大數據場景使用） |


## 最佳實踐與效能建議

| 實踐策略                           | 說明                                     |
| ------------------------------ | -------------------------------------- |
| **搭配 SummingMergeTree 做高效加總表** | 透過 MV 將大量原始數據彙總到小表，提高查詢性能              |
| **Materialized View 支援多層級彙總**  | 可以鏈接多個 MV 形成逐層聚合 (日 → 週 → 月)，減少查詢即時計算量 |
| **針對大表建 MV 時善用 Partition Key** | 讓彙總結果根據日期或業務維度分區，減少寫入與查詢時的 I/O 開銷      |
| **小心 Insert 負擔**               | 每次寫入都會觸發一次子查詢，若 MV 設計過於複雜會影響寫入效能       |
| **與 Kafka Engine 整合，實現流式彙總**   | MV 可直接從 Kafka Source 自動消費並寫入聚合結果表      |


## 結語

Materialized View 提供了一種「自動計算、實時寫入」的聚合機制，讓 ClickHouse 能在高寫入吞吐量下依然保持查詢效能。透過合理設計源表、目標表、聚合邏輯與表引擎選擇，Materialized View 可成為數據分析場景中的效能加速器。

### ClickHouse 系列持續更新中:

1. [ClickHouse 系列：ClickHouse 是什麼？與傳統 OLAP/OLTP 資料庫的差異](https://blog.vicwen.app/posts/what-is-clickhouse/)
2. [ClickHouse 系列：ClickHouse 為什麼選擇 Column-based 儲存？講解 Row-based 與 Column-based 的核心差異](https://blog.vicwen.app/posts/clickhouse-column-row-based-storage/)
3. [ClickHouse 系列：ClickHouse 儲存引擎 - MergeTree](https://blog.vicwen.app/posts/clickhouse-mergetree-engine)
4. [ClickHouse 系列：壓縮技術與 Data Skipping Indexes 如何大幅加速查詢](https://blog.vicwen.app/posts/clickhouse-compression-skipping-index/)
5. [ClickHouse 系列：ReplacingMergeTree 與資料去重機制](https://blog.vicwen.app/posts/clickhouse-replacingmergetree-deduplication/)
6. [ClickHouse 系列：SummingMergeTree 進行資料彙總的應用場景](https://blog.vicwen.app/posts/clickhouse-summingmergetree-aggregation/)
7. [ClickHouse 系列：Materialized Views 即時聚合查詢實戰](https://blog.vicwen.app/posts/clickhouse-materialized-view/)
8. [ClickHouse 系列：分區策略與 Partition Pruning 原理解析](https://blog.vicwen.app/posts/clickhouse-partition-pruning/)
9. [ClickHouse 系列：Primary Key、Sorting Key 與 Granule 索引運作原理](https://blog.vicwen.app/posts/clickhouse-primary-sorting-key/)
10. [ClickHouse 系列：CollapsingMergeTree 與邏輯刪除的最佳實踐](https://blog.vicwen.app/posts/clickhouse-collapsingmergetree/)
11. [ClickHouse 系列：VersionedCollapsingMergeTree 版本控制與數據衝突解決](https://blog.vicwen.app/posts/clickhouse-versioned-collapsingmergetree/)
12. [ClickHouse 系列：AggregatingMergeTree 實時指標統計的進階應用](https://blog.vicwen.app/posts/clickhouse-aggregatingmergetree/)
13. [ClickHouse 系列：Distributed Table 與分布式查詢架構](https://blog.vicwen.app/posts/clickhouse-distributed-table/)
14. [ClickHouse 系列：Replicated Tables 高可用性與零停機升級實作](https://blog.vicwen.app/posts/clickhouse-replication-failover/)
15. [ClickHouse 系列：與 Kafka 整合打造即時數據流處理管道](https://blog.vicwen.app/posts/clickhouse-kafka-streaming/)
16. [ClickHouse 系列：批次匯入最佳實踐 (CSV、Parquet、Native Format)](https://blog.vicwen.app/posts/clickhouse-batch-import/)
17. [ClickHouse 系列：ClickHouse 與外部資料源整合（MySQL、S3、JDBC）](https://blog.vicwen.app/posts/clickhouse-external-data-integration/)
18. [ClickHouse 系列：查詢優化實戰 - system.query\_log 與 EXPLAIN 用法](https://blog.vicwen.app/posts/clickhouse-query-log-explain/)
19. [ClickHouse 系列：Projections 進階查詢加速技術](https://blog.vicwen.app/posts/clickhouse-projections-optimization/)
20. [ClickHouse 系列：Sampling 抽樣查詢與統計技術原理](https://blog.vicwen.app/posts/clickhouse-sampling-statistics/)
21. [ClickHouse 系列：TTL 資料清理與儲存成本優化](https://blog.vicwen.app/posts/clickhouse-ttl-storage-management/)
22. [ClickHouse 系列：儲存政策（Storage Policies）與磁碟資源分層策略](https://blog.vicwen.app/posts/clickhouse-storage-policies/)
23. [ClickHouse 系列：如何在 Kubernetes 部署 ClickHouse Cluster](https://blog.vicwen.app/posts/clickhouse-kubernetes-deployment/)
24. [ClickHouse 系列：Grafana + ClickHouse 打造高效能即時報表](https://blog.vicwen.app/posts/clickhouse-grafana-dashboard/)
25. [ClickHouse 系列：APM 日誌分析平台架構實作 (Vector + ClickHouse)](https://blog.vicwen.app/posts/clickhouse-apm-log-analytics/)
26. [ClickHouse 系列：IoT 巨量感測數據平台設計實戰](https://blog.vicwen.app/posts/clickhouse-iot-analytics/)
27. [ClickHouse 系列：與 BI 工具整合（Metabase、Superset、Power BI）](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
28. [ClickHouse 系列：ClickHouse Cloud 與自建部署的優劣比較](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
29. [ClickHouse 系列：資料庫安全性與權限管理（RBAC）實作](https://blog.vicwen.app/posts/clickhouse-security-rbac/)
30. [ClickHouse 系列：ClickHouse 發展藍圖與 2025 版本新功能預測](https://blog.vicwen.app/posts/clickhouse-roadmap-2025/)
