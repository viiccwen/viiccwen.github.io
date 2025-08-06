---
title: ClickHouse 系列：TTL 資料清理與儲存成本優化
published: 2025-08-26
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database]
category: 'software development'
draft: false 
lang: ''
---

隨著時間的資料量成長，如何免去手工、使用自動化進行過期資料清理與儲存成本控制，成為大型數據系統設計中不可忽視的一環。ClickHouse 提供了 **TTL（Time To Live）資料清理機制**，不僅能自動刪除過期資料，還能將資料移動至冷儲存 (如 S3、HDD)，有效降低儲存成本。

## 什麼是 TTL？

TTL (Time To Live) 是指設定資料的「生命週期」，當資料達到指定條件時，ClickHouse 會自動進行清理（刪除）或儲存層級移動 (Move to Volume)。

TTL 可以套用在：

1. **整行資料 (Row TTL)** → 自動刪除過期資料。
2. **欄位資料 (Column TTL)** → 針對指定欄位進行清理。
3. **Volume TTL** → 將資料從 SSD 移至 HDD/S3 等不同 Volume 以降低儲存成本。

## 範例

### 1. Row TTL：自動刪除過期資料

```sql
CREATE TABLE events
(
    EventDate DateTime,
    UserID UInt64,
    Action String
) ENGINE = MergeTree
PARTITION BY toYYYYMM(EventDate)
ORDER BY (UserID, EventDate)
TTL EventDate + INTERVAL 7 DAY;
```

這會讓資料在 `EventDate` 超過 7 天後，自動被清除。

### 2. Column TTL：指定欄位過期清除

```sql
CREATE TABLE logs
(
    EventDate DateTime,
    UserID UInt64,
    Action String,
    TempField String TTL EventDate + INTERVAL 1 DAY
) ENGINE = MergeTree
ORDER BY UserID;
```

`TempField` 欄位資料會在 1 天後被清除，但行資料仍會保留。

### 3. Volume TTL：自動分層存儲 (Hot → Cold Storage)

```xml
// config.xml
<storage_configuration>
    <disks>
        <disk_ssd>
            <path>/var/lib/clickhouse/ssd/</path>
        </disk_ssd>
        <disk_hdd>
            <path>/var/lib/clickhouse/hdd/</path>
        </disk_hdd>
    </disks>
    <policies>
        <tiered_policy>
            <volumes>
                <hot>
                    <disk>disk_ssd</disk>
                </hot>
                <cold>
                    <disk>disk_hdd</disk>
                    <max_data_part_size_bytes>5000000000</max_data_part_size_bytes>
                </cold>
            </volumes>
        </tiered_policy>
    </policies>
</storage_configuration>
```

```sql
CREATE TABLE events_tiered
(
    EventDate DateTime,
    UserID UInt64,
    Action String
) ENGINE = MergeTree
ORDER BY (UserID, EventDate)
SETTINGS storage_policy = 'tiered_policy'
TTL EventDate + INTERVAL 7 DAY TO VOLUME 'cold';
```

* 前 7 天資料會放在 SSD (Hot)
* 超過 7 天後資料會自動移動到 HDD (Cold)

## TTL 清理原理與執行時機

| 觸發時機                   | 說明                                |
| ---------------------- | --------------------------------- |
| **背景合併 (Merge)**       | TTL 清理與 Volume 移動是在 Merge 階段一併處理。 |
| **ALTER TABLE FREEZE** | 可以手動強制觸發。                         |
| **清理非即時性**             | TTL 並非即時刪除，取決於背景合併頻率與資源情況。        |

建議：

* 調整 **merge\_with\_ttl\_timeout** 與 **merge\_with\_recompression\_ttl\_timeout** 設定，縮短 TTL 觸發時間。
* 查看 **system.part\_log** 可追蹤哪些 Data Part 進行了 TTL 動作。

## 案例

### 即時行為數據保留 7 天

```sql
CREATE TABLE user_behavior
(
    EventDate DateTime,
    UserID UInt64,
    Action String
) ENGINE = MergeTree
ORDER BY (UserID, EventDate)
TTL EventDate + INTERVAL 7 DAY;
```

### 詳細 Log 移至冷存儲，保留近 3 天的熱資料

```sql
CREATE TABLE logs_tiered
(
    EventDate DateTime,
    LogID UUID,
    Details String
) ENGINE = MergeTree
ORDER BY (LogID, EventDate)
SETTINGS storage_policy = 'tiered_policy'
TTL EventDate + INTERVAL 3 DAY TO VOLUME 'cold';
```

## 監控與驗證 TTL 執行情況

1. **查詢資料片段 TTL 狀態：**

```sql
SELECT table, partition_id, min(min_ttl), min(max_ttl)
FROM system.parts
WHERE active = 1
GROUP BY table, partition_id;
```

2. **強制清理 (不建議頻繁使用)：**

```sql
OPTIMIZE TABLE events FINAL;
```

3. **追蹤 Part 變化紀錄 (`system.part_log`)：**

```sql
SELECT * FROM system.part_log WHERE event_type = 'MergeParts' AND table = 'events';
```

## 結語

TTL 不只是過期資料清理，更是**控制 ClickHouse 儲存資源分層 (SSD → HDD → S3)** 的重要利器。適當設計 TTL 策略，能幫助你在效能與成本之間取得最佳平衡。（老闆也會很愛你的）

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
26. [ClickHouse 系列：IoT 巨量感測資料平台設計實戰](https://blog.vicwen.app/posts/clickhouse-iot-analytics/)
27. [ClickHouse 系列：與 BI 工具整合（Metabase、Superset、Power BI）](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
28. [ClickHouse 系列：ClickHouse Cloud 與自建部署的優劣比較](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
29. [ClickHouse 系列：資料庫安全性與權限管理（RBAC）實作](https://blog.vicwen.app/posts/clickhouse-security-rbac/)
30. [ClickHouse 系列：ClickHouse 發展藍圖與 2025 版本新功能預測](https://blog.vicwen.app/posts/clickhouse-roadmap-2025/)

