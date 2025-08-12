---
title: ClickHouse 系列：ReplacingMergeTree 與資料去重機制
published: 2025-08-08
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, 鐵人賽]
category: 'software development'
draft: false 
lang: ''
---

在大數據環境中，「資料重複」是常見且麻煩的問題，尤其是在 ETL Pipeline 或實時資料流匯入（如 Kafka Stream）時，重複資料會嚴重影響統計結果與查詢性能。ClickHouse 提供了一套簡單卻強大的去重機制：**ReplacingMergeTree 儲存引擎**。

本篇文章將帶你深入了解 ReplacingMergeTree 的運作原理、使用場景與 Best Practice。

## ReplacingMergeTree 是什麼？

ReplacingMergeTree 是 ClickHouse MergeTree 家族的一員（~家族真熱鬧~），它能在背景 Merge 操作時，自動根據指定欄位 (如 version 欄位) 將重複資料去除，保留最新版本或最先寫入的那一筆。

### 運作邏輯：

1. 在 INSERT 資料時 **不會即時去重**，資料會以 Data Part 形式寫入磁碟。
2. 在 **背景 Merge 操作時**，根據 Primary Key 進行資料比對，若發現重複記錄（相同 Primary Key），則保留 version 最大值 (或任一筆若無 version)。
3. 資料去重是 **非即時、最終一致性** 的，實際去重點發生於 Merge 階段。

## ReplacingMergeTree 的語法與範例

```sql
CREATE TABLE user_profiles
(
    user_id UInt64,
    profile_version UInt32,
    name String,
    email String
) ENGINE = ReplacingMergeTree(profile_version)
ORDER BY user_id;
```

* `profile_version` 為版本欄位，決定在去重時保留最新版本。
* 若不指定 version，系統會隨機保留其中一筆（不保證順序），走一個俄羅斯輪盤風格。

```sql
INSERT INTO user_profiles VALUES (1, 1, 'Alice', 'alice_v1@example.com');
INSERT INTO user_profiles VALUES (1, 2, 'Alice', 'alice_v2@example.com');
INSERT INTO user_profiles VALUES (2, 1, 'Bob', 'bob@example.com');
```

查詢時可能會看到重複資料，因為去重尚未透過 Merge 發生：

```sql
SELECT * FROM user_profiles WHERE user_id = 1;
```

結果：

| user\_id | profile\_version | name  | email                                                |
| -------- | ---------------- | ----- | ---------------------------------------------------- |
| 1        | 1                | Alice | [alice\_v1@example.com](mailto:alice_v1@example.com) |
| 1        | 2                | Alice | [alice\_v2@example.com](mailto:alice_v2@example.com) |

進行 `FINAL` 查詢語法後（ `FINAL` 確保查詢時「讀到最新去重後的結果」）：

```sql
OPTIMIZE TABLE user_profiles FINAL;
```

```sql
SELECT * FROM user_profiles FINAL WHERE user_id = 1;
```

:::important
`OPTIMIZE`：強制執行資料片段 (Data Parts) 合併動作，把分散的小 Data Parts 合併成大 Part，並同時觸發資料去重（ReplacingMergeTree）或聚合（SummingMergeTree）等邏輯。

**實質影響的是磁碟上的 Data Parts 資料**，合併結果是永久性（會寫入磁碟）。
:::

再查詢結果只會剩下 `version = 2` 的那筆資料。

## ReplacingMergeTree 跟 Primary Key 的關係

* **去重是基於 `Primary Key` 判斷的**，因此建表時的 `ORDER BY` 欄位（也就是 `Primary Key`）必須正確設計。
* 若 `ORDER BY` 欄位無法唯一識別一筆記錄，則 `ReplacingMergeTree` 可能會保留錯誤的資料版本。

### 範例：

```sql
ORDER BY (user_id, profile_version)
```

這種情況下，ReplacingMergeTree 無法自動去重，因為 Primary Key 已包含 version 值，會將每個版本當成不同資料。

正確設計應該是：

```sql
ORDER BY user_id
```

## ReplacingMergeTree 使用時機與適用場景

| 場景                         | 說明                                  |
| -------------------------- | ----------------------------------- |
| **Kafka / Stream 資料流重放去重** | 多次 Consume、資料重放（At-least-once 保證）情境下自動去重。 |
| **批次資料匯入過濾重複**             | ETL 導入過程中重複載入相同資料，透過背景去重保證數據唯一性。    |
| **具版本控制的資料歷史維護**           | 保留最新版本數據，版本號較小的資料會在合併過程中被去除。        |
| **數據補正修正**                 | 資料寫入後若有誤，透過補寫版本號較大的修正資料覆蓋錯誤記錄。      |

## ReplacingMergeTree v.s. AggregatingMergeTree

| 特性       | ReplacingMergeTree                 | AggregatingMergeTree              |
| -------- | ---------------------------------- | --------------------------------- |
| 核心功能     | 根據 `Primary Key` 去重，保留 `version` 最大的資料 | 根據 `AggregateFunction` 資料型別進行合併彙總   |
| 版本欄位     | 可選，無指定時保留任一筆                       | 無需版本欄位                            |
| 適用場景     | 重複資料去除、最新版本數據保持                    | 預先彙總的數據庫，如行為統計、即時計數               |
| Merge 過程 | 合併時將相同主鍵的資料合併為一筆                   | 合併時將 `AggregateFunction` 聚合運算結果計算出來 |

## ReplacingMergeTree 常見誤區與最佳實踐

### 常見誤區：

1. **以為寫入時就會去重** → **錯！** `ReplacingMergeTree` 是 **背景合併去重**。
2. **ORDER BY 選錯欄位** → 主鍵沒選好，去重完全無效。
3. **期待去重後數據即時查詢結果就正確** → 無強制 Optimize 時可能仍查到重複數據。

### 最佳實踐：

* 對於重複資料容忍度低的系統，可在寫入後定期執行 `OPTIMIZE TABLE FINAL` 來確保資料唯一。
* 若為實時查詢應用，並且資料版本需求複雜，考慮用 **ReplacingMergeTree + Materialized View** 實作即時計算最新版本視圖。
* 設計 `Primary Key` 時，應僅包含「能唯一識別一筆邏輯記錄」的欄位，不要把 `version` 放進 `ORDER BY`。

## ReplacingMergeTree 與去重效能影響

* `ReplacingMergeTree` 的寫入效能與 `MergeTree` 相近，因為去重是延遲處理的，不影響寫入吞吐量。
* 背景合併 (Merge) 時會額外進行去重比對，Merge 負載會稍大，但對查詢來說，去重後反而能大幅減少掃描資料量。
* 資料去重完成後，儲存空間可獲得顯著節省（取決於重複數據比例）。

## 結語

`ReplacingMergeTree` 提供了一種無需複雜索引或額外處理邏輯即可實現數據去重的輕量解決方案，非常適合用於 **「資料流去重」、「批次匯入防重複」、「版本控制」** 等場景。
然而，了解其 **去重時機** 與 **`Primary Key` 設計要點** 是使用這個引擎的關鍵。

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
23. [ClickHouse 系列：如何在 Kubernetes 部署 ClickHouse Cluster](https://blog.vicwen.app/posts/clickhouse-kubernetes-deployment/)
24. [ClickHouse 系列：ClickHouse 系列：整合 Grafana 打造可視化監控](https://blog.vicwen.app/posts/clickhouse-grafana-dashboard/)
25. [ClickHouse 系列：APM 日誌分析平台架構實作 (Vector + ClickHouse)](https://blog.vicwen.app/posts/clickhouse-apm-log-analytics/)
26. [ClickHouse 系列：IoT 巨量感測數據平台設計實戰](https://blog.vicwen.app/posts/clickhouse-iot-analytics/)
27. [ClickHouse 系列：與 BI 工具整合（Power BI）](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
28. [ClickHouse 系列：ClickHouse Cloud 與自建部署的優劣比較](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
29. [ClickHouse 系列：資料庫安全性與權限管理（RBAC）實作](https://blog.vicwen.app/posts/clickhouse-security-rbac/)

