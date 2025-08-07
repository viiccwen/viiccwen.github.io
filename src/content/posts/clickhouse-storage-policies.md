---
title: ClickHouse 系列：儲存政策（Storage Policies）與磁碟資源分層策略
published: 2025-08-25
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database]
category: 'software development'
draft: false 
lang: ''
---

當你的 ClickHouse 資料規模從 GB、TB 成長到 PB 時，**如何妥善分配 SSD、HDD、甚至雲端冷儲存資源**，變得至關重要。ClickHouse 透過 **Storage Policies (儲存政策)**，提供了極為靈活的磁碟分層架構，不僅能優化查詢效能，也能大幅降低儲存成本。

## Storage Policies 是什麼？

Storage Policies 是 ClickHouse 內部管理資料儲存位置與分層邏輯的配置機制。它將磁碟資源劃分為不同層級（Volumes），並根據資料大小、TTL、Merge 條件等動態將資料移動至不同層級磁碟。

你可以做到：
1. 熱資料存在 SSD，冷資料自動移至 HDD 或雲端 S3。
2. 根據 Data Part 大小動態調度存儲位置。
3. 搭配 TTL 策略，實現資料生命週期全自動管理。

## 二、Storage Policies 結構

```xml
<storage_configuration>
    <disks>
        <disk_ssd>
            <path>/var/lib/clickhouse/ssd/</path>
        </disk_ssd>
        <disk_hdd>
            <path>/var/lib/clickhouse/hdd/</path>
        </disk_hdd>
        <disk_s3>
            <type>s3</type>
            <endpoint>https://s3.amazonaws.com/your-bucket/</endpoint>
            <access_key_id>YOUR_KEY</access_key_id>
            <secret_access_key>YOUR_SECRET</secret_access_key>
        </disk_s3>
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
                <archive>
                    <disk>disk_s3</disk>
                </archive>
            </volumes>
        </tiered_policy>
    </policies>
</storage_configuration>
```

## 三、磁碟分層（Volumes）設計原則

| 層級          | 磁碟類型 | 適用資料            | 說明               |
| ----------- | ---- | --------------- | ---------------- |
| **Hot**     | SSD  | 近 7 天高頻查詢資料     | 保證讀取速度與低延遲       |
| **Cold**    | HDD  | 歷史數據或低頻查詢資料     | 儲存成本較低，適合冷資料     |
| **Archive** | S3   | 歸檔資料、不常查詢但需長期保留 | 跨區域備份、儲存無上限、成本最低 |

## 配合 TTL 實現自動熱冷資料分層

```sql
CREATE TABLE user_logs
(
    EventDate DateTime,
    UserID UInt64,
    Action String
) ENGINE = MergeTree
ORDER BY (UserID, EventDate)
SETTINGS storage_policy = 'tiered_policy'
TTL EventDate + INTERVAL 7 DAY TO VOLUME 'cold',
    EventDate + INTERVAL 30 DAY TO VOLUME 'archive';
```

這樣設計後：

* 近 7 天資料會在 SSD。
* 7 天到 30 天資料移動到 HDD。
* 超過 30 天資料會自動移到 S3 儲存。

## 觀察資料分佈情況

```sql
SELECT
    name AS table_name,
    disk_name,
    count() AS parts
FROM system.parts
WHERE active AND table = 'user_logs'
GROUP BY table_name, disk_name;
```

能夠即時掌握資料是儲存在 SSD、HDD，還是 S3。

## Storage Policies 與 MergeTree 的互動

* **新資料寫入 → Hot Volume**（除非超過 Part Size 限制）。
* **背景合併 (Merge) 時會根據 Part 大小、TTL 將資料移動至下層 Volume**。
* **儲存層級的選擇與分配完全由 Storage Policies 決定**，不需手動干預。

## 儲存政策最佳實踐

1. **分層設計要「能自動運作」** → 不需手動移動資料。
2. **選擇適合的磁碟路徑與掛載點** → SSD 用於熱資料、HDD 為冷資料、S3 作為歷史歸檔。
3. **搭配 TTL 做時間序列資料管理** → 自動清理與降層儲存。
4. **監控系統.parts 與.part\_log** → 定期檢查 Part 移動情況與執行效能。

## 進階：監控 Storage Policies 實際運作情況

ClickHouse 提供了 `system.storage_policies` 系統表，讓你能夠隨時檢查 **Storage Policies 與 Volume 配置**，並了解磁碟資源的優先順序與分層邏輯。

### `system.storage_policies` 欄位解讀

| 欄位名稱                               | 說明                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------- |
| **policy\_name**                   | 儲存政策名稱。                                                                 |
| **volume\_name**                   | 所屬 Volume 名稱。                                                           |
| **volume\_priority**               | Volume 優先順序，數字越小優先度越高 (0 最優先)。                                          |
| **disks**                          | 該 Volume 內包含的磁碟列表。                                                      |
| **volume\_type**                   | Volume 類型 (JBOD, SINGLE\_DISK, UNKNOWN)。                                |
| **max\_data\_part\_size**          | 該 Volume 可儲存的最大 Data Part 大小 (0 代表無上限)。                                 |
| **move\_factor**                   | 當 Volume 剩餘空間不足 (Free Space Ratio 超過此值) 時，ClickHouse 會將資料移動到下一個 Volume。 |
| **prefer\_not\_to\_merge**         | 是否避免在該 Volume 進行 Merge（理論上不建議啟用）。                                       |
| **perform\_ttl\_move\_on\_insert** | 插入資料時若符合 TTL 規則是否立即執行移動。                                                |
| **load\_balancing**                | 當 Volume 中包含多顆磁碟時，資料寫入的負載平衡策略（ROUND\_ROBIN 或 LEAST\_USED）。              |

### 檢查儲存政策與 Volume 配置

```sql
SELECT
    policy_name,
    volume_name,
    volume_priority,
    disks,
    volume_type,
    max_data_part_size,
    move_factor,
    load_balancing
FROM system.storage_policies
WHERE policy_name = 'tiered_policy';
```

## 結語

ClickHouse 的 Storage Policies 不僅僅是磁碟資源管理工具，更是「大規模數據儲存成本優化策略」的核心武器。只要正確設計，就能讓你的 ClickHouse 叢集具備自動儲存分層、效能與成本兼顧的絕佳特性。

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


