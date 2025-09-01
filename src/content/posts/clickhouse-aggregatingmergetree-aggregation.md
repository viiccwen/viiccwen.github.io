---
title: ClickHouse 系列：AggregatingMergeTree 實時指標統計的進階應用
published: 2025-08-15
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, 鐵人賽, Distributed]
category: 'software development'
draft: false 
lang: ''
---

在大型資料分析系統中，隨著資料規模與查詢複雜度提升，單純依賴 SELECT 聚合查詢（如 SUM、COUNT、AVG）將無法滿足即時回應的需求。ClickHouse 針對高效聚合查詢場景，提供了 **AggregatingMergeTree** 儲存引擎，透過預計算 (Pre-Aggregation) 與聚合函數壓縮 (AggregateFunction 型別)，大幅降低查詢延遲。

### 什麼是 AggregatingMergeTree？

AggregatingMergeTree 是 ClickHouse MergeTree 家族中的「聚合專用儲存引擎」，其特點是：

* 資料寫入時儲存為 **AggregateFunction 型別**（預計算的聚合狀態）。
* Merge 階段進行 **狀態合併 (State Merging)**，將多筆相同 Primary Key 的聚合結果進行再彙總。
* 查詢時透過 **聚合狀態還原 (State Finalization)**，將狀態轉為最終數值結果。

這種設計特別適合高頻寫入 + 聚合查詢的場景，如：網站流量統計、實時 KPI 指標儀表板、IoT 裝置資料彙總。

### 與 SummingMergeTree 的差異比較

| 特性           | SummingMergeTree           | AggregatingMergeTree                                 |
| ------------ | -------------------------- | ---------------------------------------------------- |
| 支援聚合函數       | 只支援 SUM                    | 支援所有 AggregateFunction (如 SUM, AVG, COUNT, MIN, MAX) |
| 資料儲存型別       | 普通數值欄位 (UInt, Float)       | AggregateFunction 型別 (儲存聚合狀態)                        |
| Merge 時是否會聚合 | 會針對 Primary Key 相同的數值欄位做加總 | 會將相同 Primary Key 的聚合狀態進行合併                           |
| 查詢時是否需特殊處理   | 不需特殊處理，直接 SELECT 查詢即可      | 查詢時需使用聚合函數將狀態還原（如 sumMerge(col), avgMerge(col)）      |
| 適用場景         | 計數器類型（PV、點擊數、金額彙總）         | 複雜聚合運算（平均值、去重計數、分位數、標準差等統計需求）                        |

### 語法與基本範例

#### 建立 Source Table, AggregatingMergeTree Table, MV Table：

```sql

-- Source Table
CREATE TABLE visits (
    StartDate DateTime64 NOT NULL,
    CounterID UInt64,
    Sign Nullable(Int32),
    UserID Nullable(Int32)
) ENGINE = MergeTree ORDER BY (StartDate, CounterID);

-- AggregatingMergeTree Table
CREATE TABLE agg_visits (
    StartDate DateTime64 NOT NULL,
    CounterID UInt64,
    Visits AggregateFunction(sum, Int32),
    Users AggregateFunction(uniqExact, Int32)
)
ENGINE = AggregatingMergeTree()
ORDER BY (StartDate, CounterID);

-- Materialized View Table
CREATE MATERIALIZED VIEW visits_mv TO agg_visits
AS SELECT
    StartDate,
    CounterID,
    sumState(Sign) AS Visits,
    uniqState(UserID) AS Users
FROM visits
GROUP BY StartDate, CounterID;
```

#### 寫入資料 (以聚合狀態寫入)：

```sql
INSERT INTO visits (StartDate, CounterID, Sign, UserID)
 VALUES (1667446031000, 1, 3, 4), (1667446031000, 1, 6, 3);
```

資料會同時寫入 `visits` 和 `agg_visits` Table

#### 查詢聚合結果 (需用 Merge 函數還原狀態)：

```sql
SELECT
    StartDate,
    sumMerge(Visits) AS Visits,
    uniqMerge(Users) AS Users
FROM test.visits_mv
GROUP BY StartDate
ORDER BY StartDate;
```

```
┌───────────────StartDate─┬─Visits─┬─Users─┐
│ 2022-11-03 03:27:11.000 │      9 │     2 │
└─────────────────────────┴────────┴───────┘
```

### 運作流程

1. **資料寫入 (AggregateFunction 狀態寫入)**

   * 透過 `sumState()`, `avgState()`, `uniqExactState()` 等函數將資料寫入為「聚合狀態」。
2. **背景 Merge 操作 (State Merging)**

   * 當相同 Primary Key 的資料進行合併時，ClickHouse 會將 AggregateFunction 狀態進行「狀態合併」。
   * 這個過程發生於背景合併 (Merge)，不影響寫入吞吐量。
3. **查詢時還原聚合結果 (State Finalization)**

   * 查詢時需透過 `sumMerge()`, `avgMerge()`, `uniqExactMerge()` 等函數將聚合狀態還原為最終數值。

### 應用場景

| 應用場景                          | 說明                                         |
| ----------------------------- | ------------------------------------------ |
| **即時流量與使用者指標統計 (PV / UV 報表)**  | 大量寫入使用者行為事件，彙總統計每天每頁面瀏覽量與不重複訪客數 (uniqExact) |
| **IoT 裝置資料彙總與即時狀態統計**         | 實時收集 IoT 感測器資料，進行彙總平均值、最大最小值、分位數計算         |
| **行為事件流去重與複雜指標計算**            | 如多指標 KPI 彙總、Session Duration 平均值等需進階統計場景   |
| **資料層級預聚合 (Pre-Aggregation)** | 針對查詢頻繁的聚合結果進行預先計算，減少查詢時的 CPU 負載與 I/O 操作    |

### 改進：延遲聚合至 Merge 階段

為了將聚合計算成本從 INSERT 時移至 Merge 階段，可以這麼做：

```sql
SET optimize_on_insert = 0;

CREATE MATERIALIZED VIEW visits_mv TO agg_visits
AS SELECT
    StartDate,
    CounterID,
    initializeAggregation('sum', Sign) AS Visits,
    initializeAggregation('uniqExact', UserID) AS Users
FROM visits;
```

透過以下兩個關鍵步驟：

* `initializeAggregation()`：將原始值轉為聚合狀態寫入，無需 Group By。
* `optimize_on_insert = 0`：關閉插入時的自動聚合優化，將聚合推遲到後續 Merge 操作進行。

可以帶來：
1. **減少 INSERT 時的計算壓力 (極大化寫入吞吐)**
    * 傳統 Materialized View 的預聚合邏輯：每次寫入 (INSERT) 都需要先做 Group By 聚合計算，這會對 CPU 與 Memory 造成即時壓力，寫入高峰時，會拖慢寫入速度。
    * initializeAggregation + optimize_on_insert = 0：每筆資料直接以「聚合狀態」寫入，無需即時計算聚合結果，讓 INSERT 成本變成「純寫檔案 + 生成狀態」的低成本操作。
    * 特別適合每秒數萬、數十萬筆的高頻寫入場景，如 IoT、網站點擊流、使用者行為追蹤。
2. **聚合計算的成本被「平滑化」到背景 Merge**
    * 傳統的預聚合方式會把所有聚合計算都集中在 INSERT 時進行，當寫入高峰時，資源使用率會瞬間飆升。
    * initializeAggregation 模式將聚合邏輯延遲到 Merge 階段，讓這些計算能夠由 ClickHouse 以 **批次、自動、分散式**的方式在背景進行。所以背景 Merge 可以根據系統負載動態調整，不會對線上寫入與查詢造成即時衝擊，更能彈性調整 Merge 策略 (如 TTL-based Merge、optimize_final 週期性合併)。

#### 為什麼 `initializeAggregation` 必須搭配 `optimize_on_insert = 0`？

當使用 `initializeAggregation()` 時，ClickHouse 會為每筆資料產生一個「尚未合併的 Aggregate State」，這讓每筆資料都能保留獨立的聚合狀態，直到 MergeTree 在背景進行合併 (Merge) 時，才會把相同 Primary Key 的資料進行實際聚合。

然而，這種「不經 Group By 預聚合」的行為，預設情況下 (`optimize_on_insert = 1`) 是無法成立的，因為 ClickHouse 會自動優化將相同 Key 的資料提前聚合後才寫入 (insert-time pre-aggregation)。

只有當你將 `optimize_on_insert` 設為 0 時，ClickHouse 才會跳過這個 insert-time pre-aggregation 優化邏輯，將資料原封不動地寫入 AggregatingMergeTree，並將聚合計算延遲到 Merge 階段進行。

#### 效果

| 條件                                                 | 行為                                         |
| -------------------------------------------------- | ------------------------------------------ |
| `initializeAggregation() + optimize_on_insert = 0` | 每筆來源資料都寫入為單獨的聚合狀態，查詢時需依賴背景 Merge 來獲得最終聚合結果 |
| `initializeAggregation() + optimize_on_insert = 1` | ClickHouse 會自動進行 Group By 聚合後才寫入           |
| 傳統 `sumState() + Group By` 寫法                        | INSERT 時資料已經被預先聚合                          |


### Best Practice

| Best Practice                        | 說明                                                  |
| --------------------------- | --------------------------------------------------- |
| 聚合狀態資料需搭配 State/ Merge 函數處理 | INSERT 時寫入 State，SELECT 時用 Merge 函數還原               |
| Primary Key 設計決定 Merge 粒度   | ORDER BY 應設計為能唯一標識聚合維度 (如 date, page)，避免去重無效或合併過大範圍 |
| 結合 Partition Key 進行資料區塊管理   | 減少 Merge 時的資源消耗，提高查詢裁剪效率                            |
| Materialized View 進行即時聚合計算  | 提升原始資料寫入到 AggregatingMergeTree 的實時性與性能              |
| 定期 OPTIMIZE FINAL 合併資料      | 確保合併後查詢結果的一致性與效能，避免過多小 Data Part 影響性能               |

### AggregatingMergeTree v.s. SummingMergeTree 選用時機

| 適用場景                 | 建議引擎選擇                           |
| -------------------- | -------------------------------- |
| 單純計數器類型 (如 PV/點擊數)   | SummingMergeTree                 |
| 需計算不重複數量 (如 UV、去重計數) | AggregatingMergeTree + uniqExact |
| 需計算平均值、分位數等進階聚合指標    | AggregatingMergeTree             |
| 資料補寫與修正較頻繁的場景        | AggregatingMergeTree             |

### 結語

個人覺得 AggregatingMergeTree 是處理「高頻寫入 + 複雜聚合統計」場景的強大工具。但內部真的很複雜 XD，知識點極多，當你在選用 MergeTree 引擎時，應當具備較深的相關知識，才能發揮很好的優化系統。

而透過 AggregateFunction 型別預儲存聚合狀態，搭配 MergeTree 的合併機制與 Materialized View 實時計算能力，能將查詢效能提升到毫秒級，極適合指標報表、流量監控、IoT 資料彙總等應用場景。

但也需留意 **Primary Key 與 Partition 設計**，才能讓聚合合併與查詢裁剪效能發揮到極致。

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
30. [ClickHouse 系列：從原始碼看 MergeTree 的七大核心機制](https://blog.vicwen.app/posts/clickhouse-mergetree-sourcecode-introduction/)
