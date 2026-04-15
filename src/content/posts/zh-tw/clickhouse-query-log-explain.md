---
title: ClickHouse 系列：如何提升查詢優化？system.query_log 與 EXPLAIN 用法
published: 2025-08-21
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, 鐵人賽]
category: 'software development'
draft: false 
lang: ''
---

在資料量日益龐大的場景下，**如何優化查詢效能** 是每一位開發者必須具備的核心能力。本篇將帶你實戰演練 ClickHouse 中兩個查詢優化利器：

1. **system.query\_log** → 查詢歷史執行效能
2. **EXPLAIN** → 預估查詢路徑與資源使用


## 什麼是 system.query_log？

system.query_log 是 ClickHouse 內建的查詢歷史紀錄表，它會紀錄每一筆查詢的：
* 啟動時間、執行耗時
* 資源使用量 (讀取行數、記憶體用量)
* 查詢錯誤與異常
* 使用者、來源 IP、Client 資訊
* 查詢使用的 Storage、Functions、Events

:::warning
這邊只紀錄「查詢執行的資訊」，並不會紀錄查詢的結果資料。
:::

### 查詢最近 100 筆 SELECT 查詢執行紀錄

```sql
SELECT
    query_start_time,
    query_duration_ms,
    read_rows,
    result_rows,
    query
FROM system.query_log
WHERE event_time > now() - INTERVAL 10 MINUTE
AND type = 'QueryFinish'
AND query LIKE 'SELECT%'
ORDER BY query_start_time DESC
LIMIT 100;
```

### 常見欄位解讀

| 欄位                  | 說明                  |
| ------------------- | ------------------- |
| query\_start\_time  | 查詢開始時間              |
| query\_duration\_ms | 查詢耗時 (毫秒)           |
| read\_rows          | 查詢過程中讀取的 row 數量     |
| result\_rows        | 查詢結果輸出的 row 數量      |
| memory\_usage       | 查詢執行時的記憶體使用量 (Byte) |

| type 值                       | 說明           |
| ---------------------------- | ------------ |
| `QueryStart` = 1             | 查詢開始執行時紀錄    |
| `QueryFinish` = 2            | 查詢成功完成時紀錄    |
| `ExceptionBeforeStart` = 3   | 查詢還沒執行就錯誤時紀錄 |
| `ExceptionWhileProcessing`=4 | 查詢執行中發生錯誤時紀錄 |


### 如何找出「慢查詢」？

```sql
SELECT
    query_start_time,
    query_duration_ms,
    read_rows,
    memory_usage,
    query
FROM system.query_log
WHERE event_time > now() - INTERVAL 1 HOUR
AND type = 'QueryFinish'
AND query_duration_ms > 500  -- 大於 500ms
ORDER BY query_duration_ms DESC;
```


## 什麼是 EXPLAIN ？

ClickHouse 提供 EXPLAIN 語法，讓你在查詢前預測 **查詢路徑、掃描資料量、JOIN 策略** 等細節。

### EXPLAIN SYNTAX：

```sql
EXPLAIN [AST | SYNTAX | QUERY TREE | PLAN | PIPELINE | ESTIMATE | TABLE OVERRIDE] [settings]
SELECT ...
```

| 模式             | 說明                                 |
| -------------- | ---------------------------------- |
| AST            | 顯示查詢的抽象語法樹 (Abstract Syntax Tree)。 |
| SYNTAX         | 顯示經過語法優化後的查詢結構。                    |
| QUERY TREE     | 顯示查詢邏輯樹，反映優化器進行後的結構。               |
| PLAN           | 查詢的執行計畫路徑（含掃描表、JOIN 策略等）。          |
| PIPELINE       | 查詢的執行階段與並行度資訊 (執行緒、流水線處理器等)。       |
| ESTIMATE       | 預估查詢將掃描的資料量（rows、marks、parts）。     |
| TABLE OVERRIDE | 驗證 table function 的 schema 覆寫是否正確。 |


## EXPLAIN 範例

### SYNTAX - 經語法優化後的查詢

```sql
EXPLAIN SYNTAX SELECT * FROM system.numbers WHERE number < 10;
```

```sql
SELECT *
FROM system.numbers
WHERE number < 10
```

### QUERY TREE — 最終查詢邏輯結構

```sql
EXPLAIN QUERY TREE SELECT id, value FROM test_table;
```

```sql
QUERY id: 0
  PROJECTION COLUMNS
    id UInt64
    value String
  JOIN TREE
    TABLE id: 3, table_name: default.test_table
```

這能讓你清楚知道查詢會如何去 Join Tables、哪些欄位會被投影出來。

### PLAN - 執行計畫步驟

```sql
EXPLAIN PLAN SELECT sum(number) FROM numbers(1000) GROUP BY number % 4;
```

```sql
Union
 Expression (Projection)
  Aggregating
   ReadFromStorage (SystemNumbers)
```

你可以看到從讀取資料到聚合的整個查詢執行路徑。

### ESTIMATE — 查詢預估讀取量

```sql
EXPLAIN ESTIMATE SELECT * FROM large_table WHERE date >= '2024-01-01';
```

```sql
┌─database─┬─table──────┬─parts─┬─rows───┬─marks─┐
│ default  │ large_table│     2 │ 500000 │    32 │
└──────────┴────────────┴───────┴────────┴───────┘
```

## 進階：優化一個慢查詢

1. 先用 **system.query\_log** 找到最近慢查詢。

```sql
SELECT
    query_start_time,
    query_duration_ms,
    read_rows,
    read_bytes,
    memory_usage,
    query
FROM system.query_log
WHERE event_time > now() - INTERVAL 1 HOUR
AND type = 'QueryFinish'
AND query LIKE '%order_summary%'
ORDER BY query_duration_ms DESC
LIMIT 5;
```

```sql
query_duration_ms: 4500ms
read_rows: 100000000
query: SELECT region, SUM(amount) FROM order_summary GROUP BY region;
```

2. 把該 SQL 用 **EXPLAIN PLAN** 預測路徑與資料量。

```sql
EXPLAIN PLAN SELECT region, SUM(amount) FROM order_summary GROUP BY region;
```

```sql
Expression (Projection)
 Aggregating
  ReadFromMergeTree (order_summary)
```

> 全表掃描！

3. 檢查是否：
   * 有全表掃描 (資料區塊過大)。
   * 有不必要的 JOIN → 可否轉 Materialized View。
   * 缺少 Partition Pruning、索引無法生效。

> * 查詢條件沒有加上 Partition Key (date)。
> * order_summary 按 (date, region) 分區，但查詢沒帶 date 範圍 → 全表掃描。
> * 可考慮將 region 聚合寫入 Materialized View 預先計算。

4. 調整查詢條件（如加 Partition Key 範圍、Data Skipping Index）。

```sql
SELECT region, SUM(amount)
FROM order_summary
WHERE date = today() - 1
GROUP BY region;
```

5. 再次觀察 **query\_log → 查詢耗時是否下降**。

```sql
SELECT query_duration_ms FROM system.query_log
WHERE query LIKE '%order_summary%'
AND event_time > now() - INTERVAL 5 MINUTE
AND type = 'QueryFinish'
ORDER BY query_start_time DESC
LIMIT 1;
```

```sql
query_duration_ms: 300ms
```

> `4500ms` -> `300ms` (Nice Try Diddy)

## 進階：優化一個全局掃描

```sql
SELECT user_id, COUNT(*) FROM user_events GROUP BY user_id;
```

1. 執行 EXPLAIN PLAN → 確認是否使用了 Primary Key Index。

```sql
EXPLAIN PLAN SELECT user_id, COUNT(*) FROM user_events GROUP BY user_id;
```

```sql
Expression (Projection)
 Aggregating
  ReadFromMergeTree (user_events)
```

> 完全沒有 Index 篩選，直接全表掃描。

2. 若未使用 → 加入 Partition Pruning 條件。

user_events 的 Partition Key 是 EventDate，所以我們加上日期範圍：

```sql
SELECT user_id, COUNT(*)
FROM user_events
WHERE EventDate >= today() - 7
GROUP BY user_id;
```

3. 使用 EXPLAIN ESTIMATE 檢查掃描量是否下降。

```sql
EXPLAIN ESTIMATE
SELECT user_id, COUNT(*)
FROM user_events
WHERE EventDate >= today() - 7;
```

```sql
┌─database─┬─table────────┬─parts─┬─rows──────┬─marks─┐
│ default  │ user_events  │     3 │ 10000000  │   800 │
└──────────┴──────────────┴───────┴───────────┴───────┘
```

> 原本未加條件時掃描了 1 億筆 rows，現在僅掃描 1 千萬筆，資料量明顯下降。

4. 檢查 PIPELINE 是否有並行處理。

```sql
EXPLAIN PIPELINE
SELECT user_id, COUNT(*)
FROM user_events
WHERE EventDate >= today() - 7
GROUP BY user_id;
```

> 確認查詢能夠使用多個 AggregatingTransform 節點平行處理。

5. 再次查詢 system.query_log 驗證查詢耗時是否下降。

```sql
SELECT query_duration_ms FROM system.query_log
WHERE query LIKE '%user_events%'
AND event_time > now() - INTERVAL 5 MINUTE
AND type = 'QueryFinish'
ORDER BY query_start_time DESC
LIMIT 1;
```

```sql
query_duration_ms: 600ms
```

## 結語
EXPLAIN 是 ClickHouse 優化查詢性能的核心工具，透過不同模式，你可以：
* 了解查詢的執行結構
* 預測查詢的資源消耗
* 找出瓶頸進行針對性優化

將 EXPLAIN 納入你的查詢開發流程，能讓你從「憑經驗寫查詢」升級為「數據驅動的效能優化高手」。

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
25. [ClickHouse 系列：查詢優化案例](https://blog.vicwen.app/posts/clickhouse-select-optimization/)
26. [ClickHouse 系列：與 BI 工具整合（Power BI）](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
27. [ClickHouse 系列：ClickHouse Cloud 與自建部署的優劣比較](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
28. [ClickHouse 系列：資料庫安全性與權限管理（RBAC）實作](https://blog.vicwen.app/posts/clickhouse-security-rbac/)
29. [ClickHouse 系列：Kubernetes 部署分散式架構](https://blog.vicwen.app/posts/clickhouse-operator-kubernates/)
30. [ClickHouse 系列：從原始碼看 MergeTree 的六大核心機制](https://blog.vicwen.app/posts/clickhouse-mergetree-sourcecode-introduction/)