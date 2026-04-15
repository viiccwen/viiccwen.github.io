---
title: ClickHouse 系列：Sampling 抽樣查詢與統計技術原理
published: 2025-08-23
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, 鐵人賽]
category: 'software development'
draft: false 
lang: ''
---

當面對 PB 級大數據查詢時，如何在不影響統計結論的前提下，快速獲得近似結果？ClickHouse 提供了高效的 **Sampling 抽樣查詢技術**，讓你能夠用「**1% 的資料，取得 95% 準確度的結果**」。

## 什麼是 Sampling？

Sampling 是一種讓查詢只掃描部分資料進行統計預估的技術，主要應用於：

* Dashboard 即時指標大盤
* PB 級大數據近似統計查詢
* 全表掃描耗時過久的場景

ClickHouse 透過「Sampling Key」來實現有序與隨機性兼具的抽樣機制。

## 工作原理

1. **SAMPLE BY** 欄位為 Hash 分布基準。
2. 查詢時可透過 **SAMPLE K** 讓 ClickHouse 只掃描 K 百分比的資料。
3. 抽樣是**確定性**的，對同一條件查詢結果不會改變。
4. 跨表 Sampling Key 一致時，可支援 JOIN/IN 子查詢下的抽樣一致性。

## SAMPLE 語法用法與差異

### 1. SAMPLE k

* k 為 0 到 1 的浮點數。
* 查詢會隨機挑選約 k 比例的資料片段 (Granules) 進行處理。
* 聚合值需手動乘上 K 倍來還原近似統計結果。

```sql
SELECT Action, count() * 10 AS cnt
FROM user_events
SAMPLE 0.1
GROUP BY Action;
```

這段 SQL 會只讀取 10% 資料，查詢結果再乘上 10 還原。

### 2. SAMPLE N

* N 為目標處理的行數 (近似值)。
* ClickHouse 會掃描至少 N 筆資料的顆粒 (Granules)。
* 使用 **\_sample\_factor** 虛擬欄位來自動估算放大倍率。

```sql
SELECT sum(PageViews * _sample_factor)
FROM visits
SAMPLE 10000000;
```

```sql
SELECT sum(_sample_factor)
FROM visits
SAMPLE 10000000;
```

### 3. SAMPLE k OFFSET m

* k: 取樣比例
* m: 取樣偏移量 (0\~1 之間)
* 可用於避免不同查詢 sample 重疊相同資料區塊。

```sql
SELECT *
FROM visits
SAMPLE 0.1 OFFSET 0.5;
```

## 建表時指定 Sampling Key

僅 **MergeTree 家族表引擎** 支援 Sampling，且建表時需指定 Sampling Key。

```sql
CREATE TABLE user_events
(
    EventDate DateTime,
    UserID UInt64,
    Action String
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(EventDate)
ORDER BY (UserID, EventDate)
SAMPLE BY intHash64(UserID);
```

選擇高 Cardinality 且分佈均勻的欄位 (如 UserID) 作為 SAMPLE BY 是關鍵。

## 範例：從 20 秒降到 2 秒

### 原始查詢 (全表掃描)

```sql
SELECT Action, count() FROM user_events GROUP BY Action;
-- 查詢花了：20 秒
```

### 抽樣查詢 (SAMPLE 0.1)

```sql
SELECT Action, count() * 10 FROM user_events SAMPLE 0.1 GROUP BY Action;
-- 查詢花了：2 秒
```

相較於全表掃描，抽樣查詢時間縮短 10 倍，且統計結果的誤差率維持在 5% 以內。

## Sampling 查詢驗證

透過 EXPLAIN ESTIMATE 可預估查詢將掃描的資料量。

```sql
EXPLAIN ESTIMATE SELECT * FROM user_events SAMPLE 0.1;
```

| parts | marks  | rows                     |
| ----- | ------ | ------------------------ |
| 10/10 | 100/10 | 100,000,000 / 10,000,000 |

## 常見問題與誤區

| 問題                      | 解決建議                        |
| ----------------------- | --------------------------- |
| SAMPLE 查詢無效 → 還是全表掃描    | 建表時必須指定 SAMPLE BY Key。      |
| 抽樣比例選得太小 → 統計結果誤差大      | 建議 SAMPLE 0.05\~0.2 之間較佳。   |
| SAMPLE BY 欄位選錯 → 抽樣效果失真 | 選擇分佈均勻的欄位 (如 UserID) 來避免偏倚。 |

## 結語

Sampling 是 ClickHouse 面對大數據場景中極具威力的查詢加速技術，只需簡單設定 SAMPLE BY 與 SAMPLE 百分比，即可輕鬆取得秒級的近似查詢結果，大幅減輕系統 I/O 與計算壓力。

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