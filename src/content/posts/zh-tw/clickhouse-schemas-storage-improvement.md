---
title: ClickHouse 系列：表格設計與儲存優化細節
published: 2025-08-26
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, 鐵人賽]
category: 'software development'
draft: false 
lang: ''
---

在 ClickHouse 中，表格設計並不是隨便定義欄位就好，因為不同的欄位屬性、型別選擇、壓縮策略，會直接影響 **儲存空間** 與 **查詢效能**。
今天我們就來深入探討實戰中最容易忽略的幾個細節，包括：

* Default vs Nullable 的空間差異
* 型別精簡化
* LowCardinality 的節省效果
* Codecs 壓縮技巧
* 欄位設計最佳實踐

## Default Value vs Nullable

在 ClickHouse 中，`Nullable(T)` 會額外為每列儲存一個 **null bitmap**（每列 1 bit），即使大多數值不是 NULL，也會有空間消耗。
如果欄位幾乎不會是 NULL，改用 `DEFAULT` 會更省空間。

| 設定方式     | 儲存空間       | 查詢效能  | 適用情境    |
| -------- | ---------- | ----- | ------- |
| Nullable | 多 1 bit/列  | 無明顯差異 | 資料缺失頻繁  |
| Default  | 無額外 bitmap | 無明顯差異 | 欄位幾乎都有值 |

**建議**：

```sql
-- 不推薦
age Nullable(UInt8)

-- 推薦
age UInt8 DEFAULT 0
```

## 型別精簡化

ClickHouse 的 columnar 儲存讓我們可以用更小的型別節省大量空間。

**整數範圍選擇**：

* `UInt8` → 0\~255
* `UInt16` → 0\~65535
* `UInt32` → 一般 ID
* `UInt64` → 需支援非常大的整數 ID

**浮點與 Decimal**：

* 兩位小數金額 → `Decimal(9, 2)`
* 高精度科學計算 → `Float64`

**日期與時間**：

* `Date`（2 bytes）
* `DateTime`（4 bytes）

## LowCardinality 優化字串

對於**重複率高**的字串（如地區、狀態），`LowCardinality(String)` 會使用字典映射，大幅減少重複儲存。

```sql
ALTER TABLE orders
MODIFY COLUMN status LowCardinality(String);
```

| 欄位類型                   | 重複率高時空間使用 | 重複率低時空間使用 |
| ---------------------- | --------- | --------- |
| String                 | 高         | 高         |
| LowCardinality(String) | 低         | 反而略高      |

## FixedString 的空間優化

適用固定長度欄位（如代碼、哈希值），壓縮效率高，但不足長度會補零，可能浪費空間。

```sql
code FixedString(8)
```

## Codecs 壓縮技巧

ClickHouse 可針對欄位設定壓縮方式，例如：

* `ZSTD`：高壓縮比
* `DoubleDelta`：適合時間序列數字
* `Delta`：適合日期欄位

```sql
CREATE TABLE events
(
    id UInt32 CODEC(ZSTD(3)),
    date Date CODEC(DoubleDelta)
) ENGINE = MergeTree();
```

## 欄位設計最佳實踐

1. **高基數欄位放前面** → 提高索引效率
2. **稀疏欄位分表** → 減少空值空間浪費
3. **Nested / Tuple** → 降低欄位數量與儲存 overhead

## 範例設計

```sql
CREATE TABLE user_events
(
    EventDate Date DEFAULT today(),
    UserID UInt32,
    Action LowCardinality(String),
    Version UInt8 DEFAULT 1
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(EventDate)
ORDER BY (EventDate, UserID);
```

* `EventDate` 用 Default，省掉 Nullable bitmap
* `Action` 用 LowCardinality 減少字串重複儲存
* `Version` 用 UInt8 並設定 Default

## 結語

表格設計是 ClickHouse 成本優化與效能的第一步。
透過合理選擇欄位屬性（Default、型別、LowCardinality、Codecs），可以在相同硬體資源下 **省下數倍空間**，並讓查詢速度大幅提升。

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