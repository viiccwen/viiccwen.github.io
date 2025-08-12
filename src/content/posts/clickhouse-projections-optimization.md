---
title: ClickHouse 系列：Projections 進階查詢加速技術
published: 2025-08-22
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, 鐵人賽]
category: 'software development'
draft: false 
lang: ''
---

在處理大規模資料聚合查詢時，ClickHouse 除了靠 Partition Pruning、Data Skipping Index 來加速查詢（~~忘了再回去複習~~），還有一個極具威力的查詢優化武器 — **Projections**。

Projections 能夠透過預先排序、聚合或重組資料結構，讓查詢執行路徑變得**更短、更快**。

## 什麼是 Projection？

Projection 是一種儲存在 Table Parts 內部的物化結構 (Internal Materialized View)，會針對特定查詢場景提前建立排序或聚合結果。

| 特性               | 說明                                          |
| ---------------- | ------------------------------------------- |
| 屬於 Table 的一部分    | Projection 資料與 Table 共存在同一個資料片段 (Part)。     |
| 查詢時自動命中          | 不需修改查詢語法，ClickHouse 會自動選擇最小掃描量的 Projection。 |
| 可建立多個 Projection | 針對不同查詢需求定義不同 Projections。                   |


## Projection 的優勢

1. **減少掃描資料量** → 只讀 Projection 部分資料，不需掃描全表。
2. **加快聚合計算** → 預先計算好的聚合結果，查詢時直接使用。
3. **降低 I/O 負載** → 磁碟讀取量大幅下降，查詢延遲降低。

## 範例

```sql
CREATE TABLE user_events
(
    EventDate Date,
    UserID UInt64,
    Action String,
    Version UInt32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(EventDate)
ORDER BY (UserID, EventDate)
SETTINGS index_granularity = 8192
AS
SELECT * FROM source_table;

ALTER TABLE user_events
ADD PROJECTION daily_user_action_counts
(
    SELECT
        EventDate,
        Action,
        count() AS ActionCount
    GROUP BY
        EventDate,
        Action
);
```

執行 `OPTIMIZE TABLE user_events FINAL` 後，ClickHouse 會在背景將 Projection 資料寫入 table parts 中。

## 查詢時自動命中 Projection

只要查詢符合 Projection 結構，ClickHouse 會自動使用 Projection 來加速查詢：

```sql
SELECT EventDate, Action, count() 
FROM user_events 
WHERE EventDate = '2025-08-10' 
GROUP BY EventDate, Action;
```

透過 EXPLAIN PLAN 可以看到查詢使用的是 Projection：

```sql
EXPLAIN PLAN SELECT EventDate, Action, count() FROM user_events WHERE EventDate = '2025-08-10' GROUP BY EventDate, Action;

Projection: daily_user_action_counts
ReadFromMergeTree (using projection)
```

## 實戰：Projections 加速 10 倍的案例

假設 user\_events 有 10 億筆資料，執行以下查詢：

```sql
SELECT EventDate, Action, count() 
FROM user_events 
WHERE EventDate >= '2025-08-01' 
GROUP BY EventDate, Action;
```

* **未使用 Projection**：需掃描完整 10 億筆資料，耗時 20 秒。
* **使用 Projection**：只需掃描 1 千萬筆 Projection 資料，查詢僅需 **2 秒**。

這種場景特別適合 BI 報表、Dashboard 上的高頻聚合查詢。

## 注意事項與限制

| 限制項目                                | 說明                                                  |
| ----------------------------------- | --------------------------------------------------- |
| Projection 設計需事先規劃                  | Projection 一旦定義後，其結構無法修改。                           |
| INSERT 會同時寫入 Projection             | 寫入時會增加一些 CPU 運算負擔。                                  |
| OPTIMIZE TABLE 需執行 Projection Merge | Projection 資料寫入後，需執行 Optimize 來合併 Projection Parts。 |

## 結語

Projections 是 ClickHouse 針對大規模聚合查詢加速的核心武器，透過適當的 Projection 設計，可以讓你的查詢效能瞬間提升數倍。

在需要報表統計、即時 Dashboard 的場景中，合理運用 Projections，能大幅降低系統負載與查詢延遲，成為大數據分析中的關鍵利器。


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
26. [ClickHouse 系列：IoT 巨量感測資料平台設計實戰](https://blog.vicwen.app/posts/clickhouse-iot-analytics/)
27. [ClickHouse 系列：與 BI 工具整合（Power BI）](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
28. [ClickHouse 系列：ClickHouse Cloud 與自建部署的優劣比較](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
29. [ClickHouse 系列：資料庫安全性與權限管理（RBAC）實作](https://blog.vicwen.app/posts/clickhouse-security-rbac/)

