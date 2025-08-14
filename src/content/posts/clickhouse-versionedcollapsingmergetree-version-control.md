---
title: ClickHouse 系列：VersionedCollapsingMergeTree 與資料版本控制
published: 2025-08-14
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, 鐵人賽]
category: 'software development'
draft: false 
lang: ''
---

在處理即時 Event Streaming 或高頻變動的資料場景時，僅靠 CollapsingMergeTree 的「新增/刪除」邏輯標記，往往無法應付複雜的資料狀態與版本管理需求。ClickHouse 為此提供了更進階的 **VersionedCollapsingMergeTree** 儲存引擎，透過 `sign` 與 `version` 雙欄位設計，實現更強大的資料去重與版本控制機制。

## 什麼是 VersionedCollapsingMergeTree？

VersionedCollapsingMergeTree 是在 CollapsingMergeTree 基礎上，加入版本欄位 (version) 的變種儲存引擎。
它能根據 Primary Key 判斷資料唯一性，並根據 `sign` 進行邏輯刪除，透過 `version` 來選擇保留最新版本的紀錄。

### 關鍵特性：

* `sign` 欄位：標記新增 (1) 或刪除 (-1)。
* `version` 欄位：標記每筆資料的版本號，系統會保留最大版本。
* 同一 Primary Key 下，當 `sign` 為相反數，且 `version` 值相同時，資料會被 collapse (抵消刪除)。
* 當 `version` 值不同時，會保留最大版本的資料記錄。

## 語法與範例

### 建立 VersionedCollapsingMergeTree 表格：

```sql
CREATE TABLE user_profiles
(
    user_id UInt64,
    name String,
    version UInt64,
    sign Int8
) ENGINE = VersionedCollapsingMergeTree(sign, version)
ORDER BY user_id;
```

### 插入資料：

```sql
-- 初始新增紀錄
INSERT INTO user_profiles VALUES (1, 'Alice', 1, 1);
-- 更新版本紀錄
INSERT INTO user_profiles VALUES (1, 'Alice_updated', 2, 1);
-- 刪除紀錄 (針對 version = 2)
INSERT INTO user_profiles VALUES (1, 'Alice_updated', 2, -1);
```

### 查詢結果 (未做 Merge 前)：

| user\_id | name           | version | sign |
| -------- | -------------- | ------- | ---- |
| 1        | Alice          | 1       | 1    |
| 1        | Alice\_updated | 2       | 1    |
| 1        | Alice\_updated | 2       | -1   |

執行背景 Merge (或 OPTIMIZE FINAL) 後：

* version = 2 的資料會被抵消。
* version = 1 的資料因為沒有對應的 -1 sign 紀錄，會被保留下來。

## 與 ReplacingMergeTree / CollapsingMergeTree 差異比較

| 特性                    | CollapsingMergeTree    | ReplacingMergeTree       | VersionedCollapsingMergeTree    |
| --------------------- | ---------------------- | ------------------------ | ------------------------------- |
| 邏輯刪除 (soft delete) 支援 | sign 抵消              | 無邏輯刪除 (只能用 version 覆蓋) | sign 抵消                       |
| 版本控制                  | 無內建版本概念              | version 欄位標記最新版本       | version 決定保留最大版本，結合 sign 進行去重 |
| 去重時機                  | Merge 時進行，需配合 FINAL 查詢 | Merge 時進行，需配合 FINAL 查詢   | Merge 時進行，需配合 FINAL 查詢          |
| 使用場景                  | 簡單新增/刪除標記場景            | 資料補寫/覆寫，保留最新紀錄           | 複雜補寫、刪除、版本控制需求（如事件版本回滾、補資料等）    |

## 應用場景

| 應用場景                           | 說明                                                    |
| ------------------------------ | ----------------------------------------------------- |
| **資料版本控制 (Data Versioning)**   | 保留同一 Primary Key 的最新版本資料，並可透過補寫與刪除控制資料狀態。             |
| **即時資料流去重與狀態管理**               | 處理 Kafka、Message Queue 中的事件重放與修正，確保資料流中同一主鍵下只有一筆有效紀錄。           |
| **補資料與刪除修正 (Data Correction)** | 當資料補寫/刪除需要依賴複雜的版本邏輯時，比單純的 CollapsingMergeTree 更合適。    |
| **IoT 或實時指標狀態更新場景**            | 同一設備 (如 sensor\_id) 狀態不斷更新，需保證資料只保留最新狀態值，並能正確處理刪除與修正。 |

## 查詢注意事項

* 資料去重與版本選擇會在背景 Merge 階段發生。
* 查詢最終結果需使用 `FINAL` 關鍵字保證一致性：

  ```sql
  SELECT * FROM user_profiles FINAL;
  ```
* 若資料量大，不建議頻繁全表 FINAL 查詢，可透過：

  * Partition 粒度縮小查詢範圍
  * 定期執行 `OPTIMIZE TABLE ... FINAL` 保持資料狀態穩定

## 範例

假設你正在開發一個使用者行為追蹤平台，需要補寫錯誤事件並能正確刪除修正資料：

1. **使用者行為事件流表格設計**：

   ```sql
   CREATE TABLE user_events
   (
       user_id UInt64,
       event_type String,
       event_time DateTime,
       version UInt64,
       sign Int8
   ) ENGINE = VersionedCollapsingMergeTree(sign, version)
   ORDER BY (user_id, event_time);
   ```

2. **寫入行為事件與補寫修正資料**：

   ```sql
   INSERT INTO user_events VALUES (1001, 'click', '2025-08-01 10:00:00', 1, 1);
   INSERT INTO user_events VALUES (1001, 'click', '2025-08-01 10:00:00', 2, 1); -- 修正補寫
   INSERT INTO user_events VALUES (1001, 'click', '2025-08-01 10:00:00', 2, -1); -- 取消錯誤修正
   ```

3. **查詢最終狀態**：

   ```sql
   SELECT * FROM user_events FINAL;
   ```

## Best Practice

| Best Practice                                | 說明                                                       |
| ----------------------------------- | -------------------------------------------------------- |
| Primary Key 設計應能唯一識別一筆邏輯紀錄          | 避免過細碎的主鍵組合，確保去重與版本裁剪能正確發生。                               |
| version 應為遞增且能反映資料變動邏輯              | 建議以 timestamp 或 version number 遞增欄位設計，確保去重時保留最新紀錄。       |
| sign 與 version 的邏輯需清晰一致             | 若資料補寫、刪除狀態標記混亂，將導致 Merge 時無法正確裁剪資料。                      |
| 結合 Partition Key 設計，減少 Merge 範圍裁剪成本 | 大資料場景中，Partition 可有效縮小去重與版本選擇的影響範圍，提升查詢與 Merge 效率。       |
| FINAL 查詢請盡量避免全表查詢，可透過局部分區或維運合併處理    | 資料量大的情況下，全表 FINAL 會消耗大量資源，應搭配維運腳本定期執行 Optimize FINAL 作業。 |

## 結語

VersionedCollapsingMergeTree 是解決 ClickHouse 中「資料狀態管理」與「複雜去重補資料場景」的強大引擎。它兼具 CollapsingMergeTree 的去重邏輯與 ReplacingMergeTree 的版本控制機制，適用於那些資料狀態變動頻繁且版本一致性要求高的業務場景。然而，設計上需特別留意 Primary Key、sign 與 version 的邏輯一致性，才能發揮這個引擎的最大效能優勢。

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

