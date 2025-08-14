---
title: ClickHouse 系列：Primary Key、Sorting Key 與 Granule 索引運作原理解析
published: 2025-08-12
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, 鐵人賽]
category: 'software development'
draft: false 
lang: ''
---

在 ClickHouse 的查詢加速機制中，除了 Partition Pruning 進行粗篩外，另一個細緻化資料範圍掃描的關鍵機制就是 **Primary Key (主鍵索引)、Sorting Key (排序鍵)** 與 **Granule 索引 (粒度索引)**。

## Primary Key 是什麼？

在 ClickHouse 中，Primary Key 與傳統 OLTP 資料庫中的「唯一鍵 (Unique Constraint)」不同，它 **不保證資料唯一性，也不會自動加索引樹 (如 B-Tree)**。
ClickHouse 的 Primary Key 是用來 **決定資料在磁碟中的物理排序方式 (Clustered Index)**，它是 MergeTree 引擎搜尋資料的首要索引依據。

### 特點：

* 決定資料的排序邏輯，並在查詢時作為區塊篩選的依據。
* 與 Partition Key 互補，Partition 負責粗篩區塊，Primary Key 決定區塊內的排序與定位。
* 可由一或多個欄位組成（ORDER BY 子句指定）。

### 範例：

```sql
CREATE TABLE orders
(
    order_date Date,
    user_id UInt64,
    order_id UInt64,
    amount Float64
) ENGINE = MergeTree
PARTITION BY toYYYYMM(order_date)
ORDER BY (user_id, order_date);
```

這裡的 Primary Key 是 `(user_id, order_date)`，資料會依此排序寫入磁碟。

## Sorting Key 是什麼？

* **Sorting Key = ORDER BY 子句指定的欄位組合。**
* 在 ClickHouse，Sorting Key 就是 Primary Key，只是名稱層面上的不同（某些文件會混用這兩個詞）。
* Sorting Key 決定了 Data Part 中資料的物理排序方式，並影響查詢範圍裁剪的效率。

### 小結：

| 名稱          | 說明                                 |
| ----------- | ---------------------------------- |
| Primary Key | 排序索引 (Clustered Index)，實際儲存時資料排序依據 |
| Sorting Key | 與 Primary Key 同義，但更偏向強調排序邏輯層級的用詞   |

## Granule (粒度索引) 是什麼？

Granule 是 ClickHouse 將資料拆分為查詢時可裁剪最小單位的「資料區塊」。
一個 Granule 會包含數千筆資料 (預設為 8192 rows)，系統會為每個 Granule 儲存該範圍內的 Sorting Key 最小值與最大值 (min-max 索引)。

### Granule 的查詢流程：

1. 查詢時會根據 WHERE 條件比對 Granule 的 min-max 範圍。
2. 若條件不在該 Granule 範圍內，則直接跳過讀取該 Granule。
3. 這種跳過稱為 **Primary Key 範圍裁剪 (Primary Key Indexing)**。

### Granule 的儲存結構：

* Granule ≈ 8192 rows (預設，可調整)
* 一個 Data Part 會包含多個 Granule。
* Primary Key 索引是針對 Granule 粒度儲存的 Sparse Index。

## Primary Key 範圍裁剪範例

```sql
SELECT * FROM orders WHERE user_id = 123456 AND order_date >= '2025-08-01';
```

1. 根據 Partition Key 判斷哪些 Partition 需要被讀取 (Partition Pruning)。
2. 進入符合條件的 Partition，根據 Primary Key 索引比對 Granule 範圍：
   * Granule 1：`user_id = 123455 ~ 123455` → 跳過
   * Granule 2：`user_id = 123456 ~ 123456` → 讀取
   * Granule 3：`user_id = 123457 ~ 123458` → 跳過

這種裁剪動作是查詢能夠在 TB 級資料中僅掃描少量資料的關鍵。

## Primary Key 與 Secondary Index 有何不同？

| 比較項目 | Primary Key (範圍索引)             | Secondary Index (Data Skipping Index)     |
| ---- | ------------------------------ | ----------------------------------------- |
| 運作方式 | 資料寫入時排序，查詢時透過 Granule 索引範圍裁剪   | 查詢時依欄位值範圍 (min-max / bloom filter) 決定是否讀取 |
| 查詢效率 | 查詢條件若符合排序欄位 → 裁剪效率極佳           | 可支援非排序欄位的查詢過濾，但效率不如 Primary Key           |
| 建立方式 | 透過 ORDER BY 設定，與 MergeTree 強耦合 | 需額外建立 (ALTER TABLE ADD INDEX...)          |
| 適用查詢 | 範圍查詢、序列查詢、依排序邏輯為主的查詢           | 高基數欄位查詢（如特定 tag、keyword）                  |

## Primary Key 設計策略

| 設計策略                              | 適用場景                                         |
| --------------------------------- | -------------------------------------------- |
| **常查詢範圍條件放最前面**                   | 例如 user\_id、device\_id 若常作為 WHERE 條件，應放排序鍵首位 |
| **從高選擇性到低選擇性排序**                  | user\_id → event\_date，讓 Granule 範圍更集中，裁剪更精準 |
| **避免將高變異但不查詢的欄位設為排序鍵**            | 如 UUID、隨機 hash，排序無助於裁剪，只會造成合併成本上升            |
| **結合 Partition 與 Sorting Key 設計** | Partition 粗裁剪、Primary Key 精裁剪，讓查詢僅需掃描極小範圍資料  |

## Sparse Primary Index 運作原理

ClickHouse 的 Primary Key 並不是傳統資料庫的全索引（如 B-Tree），而是設計成「**Sparse (稀疏) 索引**」，它透過 Granule (粒度區塊) 來達到大規模資料快速篩選的效果。

### 運作方式：

1. **每個 Granule 只記錄首筆資料的 Primary Key 值**：例如預設 Granule 粒度為 8192 筆，索引只會紀錄每個 Granule 第一筆資料的主鍵值。
2. **Sparse 索引非常精簡，能完全載入記憶體中**，即使資料量達到數百億筆，索引仍僅需占用少量記憶體空間。
3. **每個 MergeTree 的 Data Part 都有獨立 Primary Index**，查詢時這些索引會分別比對以達到最佳裁剪效果。
4. **查詢時，ClickHouse 根據 WHERE 條件與 Sparse Primary Index 比對 Granule 範圍**：

   * 條件範圍外的 Granule 會被直接跳過，不進行掃描。
   * 條件範圍內的 Granule 才會被讀取進行後續篩選。

### 查詢加速效果：

* 這種 Sparse 索引結構，能讓查詢只需掃描必要的 Granule，大幅減少 I/O 與記憶體資源消耗，特別是在 TB 級資料量時能明顯感受到查詢延遲的降低。

### 如何檢查 Primary Index 是否生效？

ClickHouse 提供了幾個實用的指令來協助你檢視索引運作狀況：

#### 1. 檢視索引內容：`mergeTreeIndex` table function

```sql
SELECT * FROM mergeTreeIndex('your_database.your_table', 'primary_key') LIMIT 10;
```

這可以幫助你看到每個 Granule 第一筆資料的 Primary Key 值，了解索引結構。

#### 2. 使用 `EXPLAIN` 確認索引是否被裁剪：

```sql
EXPLAIN PLAN SELECT * FROM orders WHERE user_id = 123456;
```

* 若 WHERE 條件與 Primary Key 匹配良好，查詢計劃會顯示「Granule 範圍裁剪」步驟。
* 若條件不符 (如查詢非排序欄位)，則無法利用索引進行裁剪。

#### 3. `system.parts` 觀察查詢裁剪統計：

```sql
SELECT partition, active, rows, bytes_on_disk
FROM system.parts
WHERE table = 'orders' AND active;
```

## Granule 粒度調整與效能平衡

### 調整 Granule 粒度：

* 透過 `index_granularity` 設定：

  ```sql
  CREATE TABLE t (...) ENGINE = MergeTree() ORDER BY ... SETTINGS index_granularity = 4096;
  ```
* 粒度越小，裁剪效率越高，但會增加索引大小與查詢時的 CPU 負擔。
* 粒度越大，索引資料少，CPU 開銷低，但裁剪不精確，I/O 負擔較大。

### 建議：

* 大部分場景用預設 8192 即可。
* 若查詢條件能精準對應到排序鍵且資料量大時，可考慮調小到 4096 或 2048。
* 若查詢為全表掃描或高聚合查詢為主，可將粒度放大提升查詢吞吐量。

## Best Practice

| Best Practice | 說明|
| ------------------------------- | ----------------------------------------------------------- |
| Primary Key 欄位數量建議 1\~3 欄位      | 過多欄位會增加排序成本與合併負擔，減少裁剪效果|
| 裁剪效率依賴查詢條件與排序鍵的吻合度| WHERE 條件若能對應到排序鍵首欄位，裁剪效果最佳|
| index\_granularity 避免過度微調| 除非有特殊需求，否則不建議大幅修改，預設 8192 通常是性能與資源平衡的最佳值|
| 結合 Partition 設計分層裁剪查詢| Partition 負責粗裁剪，Primary Key 精裁剪，能讓 TB 級資料也只需秒級查詢|
| 可配合 Secondary Index 提升非排序欄位查詢效率 | 如需查詢非 Primary Key 欄位 (如 tags)，可搭配 Bloom Filter Index 加速裁剪查詢 |

## 結語

Primary Key 與 Granule 索引是 ClickHouse 能在海量資料中做到毫秒級查詢的核心技術。透過合理設計 Sorting Key、調整粒度、結合 Partition Pruning，能讓資料掃描量降到最小，大幅提升查詢性能。

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
26. [ClickHouse 系列：IoT 巨量感測資料平台設計實戰](https://blog.vicwen.app/posts/clickhouse-iot-analytics/)
27. [ClickHouse 系列：與 BI 工具整合（Power BI）](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
28. [ClickHouse 系列：ClickHouse Cloud 與自建部署的優劣比較](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
29. [ClickHouse 系列：資料庫安全性與權限管理（RBAC）實作](https://blog.vicwen.app/posts/clickhouse-security-rbac/)

