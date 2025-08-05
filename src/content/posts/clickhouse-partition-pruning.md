---
title: ClickHouse 系列：分區策略與 Partition Pruning 技術，如何加速大數據查詢
published: 2025-08-13
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database]
category: 'software development'
draft: false 
lang: ''
---

當面對數億、數十億筆資料時，若每次查詢都必須掃描全表，效率勢必崩潰。ClickHouse 提供了靈活的 **分區 (Partitioning)** 與 **Partition Pruning (分區裁剪)** 技術，讓你在查詢時僅需掃描「真正相關的資料區塊」，大幅減少 I/O 與查詢延遲。

## 什麼是 Partition（分區）？

在 ClickHouse 中，**Partition 是一種邏輯資料切分單位**，資料會根據指定的 Partition Key (表達式) 被切分成獨立的資料區塊（目錄），這些區塊在查詢時可以根據條件篩選，避免全表掃描。

### 重要特性：

* Partition 是 MergeTree 引擎的核心結構之一。
* Partition Key 可以是任意表達式（如 toYYYYMM(date)、`device_id`、`region_id`）。
* Partition 是「物理檔案目錄」級別的切分，對查詢優化效果非常明顯。
* Partition 切分範圍越小，查詢時能跳過的資料越多，但會增加小檔案數量與合併負擔。

## Partition 與 Primary Key 的差異

| 比較項目 | Partition                      | Primary Key                    |
| ---- | ------------------------------ | ------------------------------ |
| 作用層級 | 資料目錄切分 (磁碟層級)                  | 區塊內排序索引 (內部儲存層級)               |
| 查詢裁剪 | 查詢條件符合 Partition Key 時可直接跳過該區塊 | 查詢條件符合 Primary Key 時可精確定位資料區塊  |
| 設計依據 | 常用範圍查詢條件，如日期、業務區域              | 常用細粒度查詢條件，如 `user_id`、`order_id` |

兩者是互補關係，Partition 用於粗略範圍裁剪、Primary Key 用於精細定位。

## Partition Pruning（分區裁剪）原理

Partition Pruning 是 ClickHouse 在查詢時根據 WHERE 條件，自動判斷哪些 Partition 是不可能有資料的，並直接跳過讀取這些資料區塊。

### 範例：

```sql
CREATE TABLE page_views
(
    event_date Date,
    user_id UInt64,
    page String
) ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, user_id);
```

### 查詢：

```sql
SELECT count() FROM page_views
WHERE event_date >= '2025-08-01' AND event_date < '2025-08-02';
```

* ClickHouse 會根據 `toYYYYMM(event_date)` 的 Partition Key 判斷，只有 202508 分區有可能符合條件，其他分區會被直接跳過，不會進行掃描。

## Partition Key 設計策略

| 設計策略                                    | 適用場景                                                     |
| --------------------------------------- | -------------------------------------------------------- |
| **以時間維度切分 (toYYYYMM, toYYYYMMDD)**      | 時間序列資料、日誌系統、流量監控 (依查詢頻率決定切分粒度)                           |
| **業務維度切分 (`region_id`, `device_type`)**   | 不同地區、設備類型獨立查詢的場景 (適合分片架構與查詢負載均衡)                         |
| **複合分區 (如 toYYYYMM(date), `region_id`)** | 時間 + 區域等複合查詢場景，但需小心 Partition 數量過多問題                     |
| **高變異欄位避免作為分區**                         | 如 user\_id、UUID 這類高基數欄位，不適合作為 Partition Key，否則會造成大量小檔案問題 |

## Partition 粒度與效率平衡

| 粒度設計           | 優點                       | 缺點                                      |
| -------------- | ------------------------ | --------------------------------------- |
| toYYYYMM       | 分區數量適中，適合查詢數月資料          | 跨月查詢效率普通，資料寫入後合併頻率較高                    |
| toYYYYMMDD     | 可將查詢裁剪精度提高至日，適合日誌系統或即時查詢 | 會產生大量小 Part，增加磁碟 IOPS 與背景合併負擔           |
| 複合分區 (時間 + 維度) | 分區粒度最細，查詢裁剪效果極佳          | 小心分區數量爆炸（建議 Partition Key 不超過 10,000 個） |

## 查詢如何確認 Partition Pruning 是否生效？

1. **使用 `EXPLAIN`**：

```sql
EXPLAIN PLAN SELECT * FROM page_views WHERE event_date = '2025-08-01';
```

2. **查詢分區讀取統計 (`system.parts`)**：

```sql
SELECT
    partition,
    active,
    rows,
    bytes_on_disk
FROM system.parts
WHERE table = 'page_views' AND active;
```

3. **觀察查詢 profile events**：

```sql
SET send_logs_level = 'trace';
SELECT count() FROM page_views WHERE event_date = '2025-08-01';
```

在查詢 Profile Events 中可以看到 `read_rows` 與 `read_bytes` 是否明顯降低。

## 實際案例

假設一個月 30 億筆網站點擊資料，未使用分區時查詢單日流量需掃描全表，I/O 延遲數十秒。若將 Partition Key 設為 toYYYYMMDD (`event_date`)：

* 單日查詢只需掃描 1/30 的資料量。
* 查詢延遲可從 30 秒降至 1 秒以內。
* 結合 Primary Key (如 `page`, `user_id`) 可進一步精確篩選。

## Partition 與分片 (Sharding) 的關係

| Partition (分區)              | Sharding (分片)                  |
| --------------------------- | ------------------------------ |
| 將單一表內的資料切分為多個資料區塊，便於裁剪查詢範圍  | 將整張表橫向切分到不同節點（叢集）上，提升分散式計算能力   |
| 分區僅影響單表查詢時的掃描範圍             | 分片影響資料的存放位置與分散式查詢執行路徑          |
| 分區裁剪靠 WHERE 條件判斷，查詢時減少掃描資料量 | 分片裁剪靠分片鍵與分布式查詢路由規則，決定哪些節點需參與查詢 |

兩者可結合設計，例如：

* 分片鍵 = `user_id`（負載均衡分散寫入）
* 分區鍵 = toYYYYMM(date)（加速範圍查詢）

## 最佳實踐與注意事項

| 最佳實踐                    | 說明                                         |
| ----------------------- | ------------------------------------------ |
| 分區 Key 依據查詢模式設計         | 針對最常用的 WHERE 範圍條件（如日期、地區）設計分區裁剪維度          |
| 小心 Partition 數量爆炸       | 避免選用高基數欄位作為分區鍵，Partition 數量建議控制在數千 ~ 一萬以內 |
| 使用 system.parts 監控分區健康度 | 定期檢查 Active Parts 數量與大小，避免過多小檔案影響合併性能      |
| 結合 Primary Key 設計精細資料定位 | 分區負責粗篩，Primary Key 負責精細定位，兩者結合達到最佳查詢效率     |
| 不建議頻繁更改 Partition Key   | Partition Key 變更等同於重建表，需謹慎設計與評估            |

## 結語

Partition Pruning 是 ClickHouse 面對大量資料時的查詢加速神器。透過合理設計分區策略，不僅能減少 I/O 負擔，更能讓你的 OLAP 報表與即時查詢在 TB 級資料量下依然保持 ms 級回應。


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
15. [ClickHouse 系列：與 Kafka 整合打造即時資料流處理管道](https://blog.vicwen.app/posts/clickhouse-kafka-streaming/)
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
