---
title: ClickHouse 系列：CollapsingMergeTree 與邏輯刪除
published: 2025-08-13
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database]
category: 'software development'
draft: false 
lang: ''
---

在傳統 OLTP 資料庫中，刪除與更新資料是家常便飯，但在 ClickHouse 這類專為 OLAP 場景設計的資料庫中，「邏輯刪除」與「資料版本控制」則需要透過特別設計的儲存引擎來實現。

**CollapsingMergeTree** 就是 ClickHouse 提供的一種能夠自動處理資料新增與刪除標記（邏輯刪除）的特殊 MergeTree 引擎。

## 什麼是 CollapsingMergeTree？

CollapsingMergeTree 是 ClickHouse MergeTree 家族的一員，設計用來解決「資料新增與刪除標記」的場景。
其運作邏輯是透過一個稱為 `sign` 的欄位標記資料的新增或刪除狀態，在背景 Merge 操作時，自動將 `sign` 相反的紀錄抵消 (collapse) 以實現邏輯刪除效果。

### 核心特性：

* 透過 `sign` 欄位標記資料狀態：`1` 代表新增，`-1` 代表刪除。
* Merge 階段會自動將相同 Primary Key 下的 `1` / `-1` 抵消掉。
* 資料刪除為「最終一致性」動作（**非即時刪除**）。

## 語法

### 建立

```sql
CREATE TABLE user_actions
(
    user_id UInt64,
    action String,
    sign Int8
) ENGINE = CollapsingMergeTree(sign)
ORDER BY user_id;
```

### 插入

```sql
-- 新增行為紀錄
INSERT INTO user_actions VALUES (1, 'login', 1);
INSERT INTO user_actions VALUES (2, 'purchase', 1);

-- 邏輯刪除 user_id = 2 的紀錄
INSERT INTO user_actions VALUES (2, 'purchase', -1);
```

### 查詢

```sql
SELECT * FROM user_actions;
```

會看到資料仍然存在，但進行 Merge 後（`FINAL`）：

```sql
OPTIMIZE TABLE user_actions FINAL;
```

`user_id = 2` 的紀錄將被抵消 (collapse) 掉，只剩下 `user_id = 1` 的資料。

## 運作原理

1. **資料寫入時不進行即時去重**，所有資料（含 `sign = -1`）都會被寫入磁碟。
2. **在背景合併 (Merge) 操作時**，ClickHouse 會根據 Primary Key 對應的資料進行配對：
   * 1 筆 `sign = 1` 與 1 筆 `sign = -1` 的資料將被抵消 (collapse)。
   * 若 sign 數量不平衡 (如 `sign = 1` 多餘 `sign = -1`)，則會保留差值的紀錄。
3. **查詢時不會自動隱藏尚未抵消的資料**，若要查詢已 collapse 的最終結果，可透過 `FINAL` 查詢保證一致性。
4. **資料刪除是最終一致性動作**，在 Merge 完成前仍會顯示原始資料。

## 應用場景

| 場景                                | 說明                                                       |
| --------------------------------- | -------------------------------------------------------- |
| **邏輯刪除 (Soft Delete)**            | 需要保留刪除紀錄但不想讓刪除資料出現在查詢結果中                                 |
| **補資料與修正紀錄 (Data Correction)**    | 錯誤資料寫入後可透過新增 `sign = -1` 的紀錄來抵銷錯誤紀錄                        |
| **Event Streaming 去重 (Event Deduplication)** | 用來消除重複事件紀錄，例如 Kafka Stream 資料去重                          |
| **資料對帳與版本控制**                     | 結合版本欄位實現更精細的資料補正與對帳邏輯（推薦使用 `VersionedCollapsingMergeTree`） |

## 與 ReplacingMergeTree 的差異比較

| 特性                | CollapsingMergeTree            | ReplacingMergeTree              |
| ----------------- | ------------------------------ | ------------------------------- |
| 資料去重方式            | 透過 sign 欄位成對抵消                 | 根據 version 欄位選擇最新資料 (或隨機選擇其中一筆) |
| 刪除資料處理            | 支援邏輯刪除 (`sign = -1` 抵消 `sign = 1`) | 不支援刪除標記，僅能透過覆蓋新版本資料處理           |
| 使用時機              | 邏輯刪除場景、Event Streaming去重、需要補寫刪除資料的場景       | 資料需去重但無需刪除紀錄 (如會員資料、訂單資料的版本替換)  |
| 查詢時是否需使用 FINAL 查詢 | 是 (否則會查到尚未 collapse 的紀錄)       | 是 (否則會查到未去重的紀錄)                 |

## 查詢時的 `FINAL` 使用與效能注意

因為 CollapsingMergeTree 的去重與刪除動作發生於 Merge 階段，在查詢時若需要**立即看到**最終一致的結果，必須加上 `FINAL` 關鍵字：

```sql
SELECT * FROM user_actions FINAL;
```

### `FINAL` 的效能注意：

* `FINAL` 查詢會強制進行去重計算，若資料量大會顯著增加查詢負擔。
* **不建議頻繁全表 FINAL 查詢**，可透過定期執行 `OPTIMIZE TABLE ... FINAL` 來維護資料一致性。

## 設計範例

### Event Streaming 去重場景：

假設從 Kafka 接收使用者行為資料，可能會出現重複寫入的情況，設計方式如下：

```sql
CREATE TABLE user_events
(
    event_time DateTime,
    user_id UInt64,
    event_type String,
    sign Int8
) ENGINE = CollapsingMergeTree(sign)
PARTITION BY toYYYYMM(event_time)
ORDER BY (user_id, event_time);
```

* 資料寫入時，重複事件會有一筆 `sign = -1` 紀錄用於去重。
* 定期執行 OPTIMIZE 確保資料正確性。
* 查詢時如無法等到合併完成，可針對小範圍使用 `FINAL` 查詢。

## Best Practice

| 最佳實踐                                   | 說明                               |
| -------------------------------------- | -------------------------------- |
| 只對需要邏輯刪除的場景使用 CollapsingMergeTree      | 若無此需求，ReplacingMergeTree 更簡單有效   |
| 設計 Primary Key 以「能唯一識別紀錄」為原則           | 避免設計過度細碎導致去重無效                   |
| 結合 Partition Key 做分區裁剪                 | 分區裁剪能有效減少 Merge 範圍，降低去重時的資源消耗    |
| 查詢大表時應避免全表 FINAL                       | 可將資料區塊切小後僅對特定 Partition FINAL 查詢 |
| 若需版本控制應考慮 VersionedCollapsingMergeTree | 可處理更複雜的資料去重與版本變更場景               |

## 結語

CollapsingMergeTree 是 ClickHouse 在處理事件去重、邏輯刪除場景下的利器。透過 `sign` 欄位標記資料狀態，搭配合適的 Primary Key 設計與背景合併策略，能夠高效實現軟刪除與資料去重邏輯。然而，對於查詢一致性需求高的場景，必須謹慎設計 FINAL 查詢策略與定期優化維護作業，以避免效能瓶頸。

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
17. [ClickHouse 系列：ClickHouse 與外部資料源整合（MySQL、S3、JDBC）](https://blog.vicwen.app/posts/clickhouse-external-data-integration/)
18. [ClickHouse 系列：如何提升查詢優化？system.query_log 與 EXPLAIN 用法](https://blog.vicwen.app/posts/clickhouse-query-log-explain/)
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
