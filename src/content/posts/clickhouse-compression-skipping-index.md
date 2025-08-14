---
title: ClickHouse 系列：壓縮技術與 Data Skipping Indexes 如何大幅加速查詢
published: 2025-08-07
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, 鐵人賽]
category: 'software development'
draft: false 
lang: ''
---

在 ClickHouse 的高性能查詢背後，除了列式存儲與向量化執行外，「壓縮技術」與「資料跳過索引（Data Skipping Indexes）」也是讓它能夠應對 PB 級數據的核心關鍵。本文將深入解析這兩項技術的原理與應用，並說明如何有效提升查詢效率、降低儲存成本。

> [One of the secrets to ClickHouse query performance is compression.](https://clickhouse.com/docs/data-compression/compression-in-clickhouse)

## 為何壓縮對 OLAP 效能如此關鍵？

在 OLAP 場景中，資料量動輒百萬、千萬筆，若未經良好壓縮處理，磁碟 I/O 將成為查詢效率瓶頸。ClickHouse 採用 Columnar Storage，讓每欄資料型態一致、重複性高，使得壓縮成效極佳。

### ClickHouse 的壓縮優勢：
* **降低磁碟儲存空間需求**（通常壓縮比達 5~10 倍以上）
* **減少磁碟 I/O 傳輸量**（更快讀取、更低延遲）
* **CPU 解壓縮效能優化**（使用輕量快速壓縮算法）

## ClickHouse 支援的壓縮編碼技術

| 壓縮編碼  | 特性與應用說明  |
| -------------------- | ------------------------------------------ |
| **LZ4 (預設)**         | 高速低延遲，壓縮比中等，預設壓縮器，適用即時查詢與寫入場景 |
| **ZSTD** | 壓縮比高於 LZ4，但壓縮/解壓速度稍慢，適合冷資料儲存或報表分析          |
| **Delta Encoding**   | 對遞增數值（如時間戳、ID）進行差值壓縮，大幅減少儲存空間              |
| **Gorilla Encoding** | 對時間序列數據極致優化，適用 IoT 與時序資料壓縮（例如 CPU 使用率、溫度等） |
| **Double Delta**     | 適用變化趨勢平穩的數值型資料，加強壓縮效果 |

以下是以 ClickHouse 儲存 StackOverflow posts 資料表的壓縮統計，透過查詢 `system.columns` 取得各欄位壓縮前後的體積與壓縮比資料

```sql
SELECT name,
   formatReadableSize(sum(data_compressed_bytes)) AS compressed_size,
   formatReadableSize(sum(data_uncompressed_bytes)) AS uncompressed_size,
   round(sum(data_uncompressed_bytes) / sum(data_compressed_bytes), 2) AS ratio
FROM system.columns
WHERE table = 'posts'
GROUP BY name

┌─name──────────────────┬─compressed_size─┬─uncompressed_size─┬───ratio────┐
│ Body                  │ 46.14 GiB       │ 127.31 GiB        │ 2.76       │
│ Title                 │ 1.20 GiB        │ 2.63 GiB          │ 2.19       │
│ Score                 │ 84.77 MiB       │ 736.45 MiB        │ 8.69       │
│ Tags                  │ 475.56 MiB      │ 1.40 GiB          │ 3.02       │
│ ParentId              │ 210.91 MiB      │ 696.20 MiB        │ 3.3        │
│ Id                    │ 111.17 MiB      │ 736.45 MiB        │ 6.62       │
│ AcceptedAnswerId      │ 81.55 MiB       │ 736.45 MiB        │ 9.03       │
│ ClosedDate            │ 13.99 MiB       │ 517.82 MiB        │ 37.02      │
│ LastActivityDate      │ 489.84 MiB      │ 964.64 MiB        │ 1.97       │
│ CommentCount          │ 37.62 MiB       │ 565.30 MiB        │ 15.03      │
│ OwnerUserId           │ 368.98 MiB      │ 736.45 MiB        │ 2          │
│ AnswerCount           │ 21.82 MiB       │ 622.35 MiB        │ 28.53      │
│ FavoriteCount         │ 280.95 KiB      │ 508.40 MiB        │ 1853.02    │
│ ViewCount             │ 95.77 MiB       │ 736.45 MiB        │ 7.69       │
│ LastEditorUserId      │ 179.47 MiB      │ 736.45 MiB        │ 4.1        │
│ ContentLicense        │ 5.45 MiB        │ 847.92 MiB        │ 155.5      │
│ OwnerDisplayName      │ 14.30 MiB       │ 142.58 MiB        │ 9.97       │
│ PostTypeId            │ 20.93 MiB       │ 565.30 MiB        │ 27         │
│ CreationDate          │ 314.17 MiB      │ 964.64 MiB        │ 3.07       │
│ LastEditDate          │ 346.32 MiB      │ 964.64 MiB        │ 2.79       │
│ LastEditorDisplayName │ 5.46 MiB        │ 124.25 MiB        │ 22.75      │
│ CommunityOwnedDate    │ 2.21 MiB        │ 509.60 MiB        │ 230.94     │
└───────────────────────┴─────────────────┴───────────────────┴────────────┘
```

你會發現：
* 高重複值欄位（如 FavoriteCount, ContentLicense）壓縮比可達數百甚至數千倍，這正是列式儲存結合專屬編碼的優勢。
* 數值型欄位（Score, AcceptedAnswerId, PostTypeId）壓縮效果也非常顯著，Delta 編碼結合 LZ4/ZSTD 能大幅減少資料體積。
* Body, Title 雖為文字型欄位，但仍有 2–3x 壓縮比，搭配 LowCardinality 設計將有更好空間優化空間。

## 如何指定壓縮算法？

你可以在建表時，透過 `CODEC` 參數指定欄位使用的壓縮編碼：

```sql
CREATE TABLE user_events (
  event_date Date,
  user_id UInt32,
  event_type String CODEC(ZSTD),
  event_value Float64 CODEC(Delta, LZ4)
) ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, user_id);
```

### 說明：

* `event_type` 使用 ZSTD，適合重複性高的字串欄位。
* `event_value` 使用 Delta 編碼處理數值，再以 LZ4 壓縮，提升查詢與儲存效能。

---

## ClickHouse 的 Data Skipping Indexes 原理

**Data Skipping Indexes（資料跳過索引）** 是 ClickHouse 特有的查詢加速技術，核心原理是：

> **在查詢時，只掃描必要的資料區塊，跳過無關區塊，降低 I/O 成本與查詢延遲。**

這些索引不是傳統意義上的 B-Tree 索引，而是針對 MergeTree 資料片段內的「欄位統計資訊」建立的快速過濾機制。

## minmax 索引如何運作？

每個 MergeTree Part 會為主鍵欄位自動建立 `minmax` 索引，例如：

```sql
SELECT * FROM orders WHERE order_date >= '2025-01-01' AND order_date < '2025-02-01';
```

* 系統會檢查每個資料區塊的 `min(order_date)` \~ `max(order_date)` 範圍。
* 若該區塊的日期範圍完全不符合查詢條件，則直接跳過不讀取！

假設你有 10 億筆日誌資料：

* 使用預設 minmax 索引查詢近一天資料，可跳過 99% 資料塊。
* 查詢延遲從 15s 降至 300ms。
* 系統僅需讀取與解壓 1% 的資料，極大節省 CPU 與 I/O 資源。

這就是 **Partition Pruning + Data Skipping** 的效果。

## 進階：Secondary Index 實作

ClickHouse 也允許你針對特定欄位建立進階索引，例如：

```sql
CREATE TABLE logs (
  timestamp DateTime,
  level String,
  message String
) ENGINE = MergeTree
ORDER BY timestamp
SETTINGS index_granularity = 8192;

ALTER TABLE logs ADD INDEX idx_level (level) TYPE set(1000) GRANULARITY 1;
```

### 索引類型說明：

| 索引類型           | 說明與應用                           |
| -------------- | ------------------------------- |
| `minmax`       | 預設，針對數值或日期範圍查詢加速                |
| `set(N)`       | 建立集合型索引，適用高重複字串欄位（如 Log Level）  |
| `ngrambf_v1`   | 適用模糊查詢，加上布隆過濾器實現快速匹配            |
| `bloom_filter` | 快速過濾欄位可能值，適用多值欄位（如 tags、labels） |


## Best Practice & Notice

* **索引粒度設定**：`index_granularity` 預設為 8192 筆，查詢越頻繁、粒度可適當調小以加速跳過效率。
* **壓縮與索引兼得**：壓縮減少資料量，索引減少掃描範圍，兩者配合達成極致查詢性能。
* **不宜濫用索引**：太多索引會增加寫入負擔，應針對查詢頻繁欄位建索引。

## 結語

ClickHouse 透過高效的壓縮與跳過索引技術，讓大數據查詢也能實現「ms級響應」。但記得不要濫用索引噢，反而會適得其反呢。

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

