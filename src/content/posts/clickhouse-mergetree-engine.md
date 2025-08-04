---
title: ClickHouse 系列：ClickHouse 儲存引擎 - MergeTree 
published: 2025-08-06
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database]
category: 'software development'
draft: false 
lang: ''
---

ClickHouse 能夠支撐高性能資料查詢的核心秘密之一，就是其強大的儲存引擎 — **MergeTree**。這一篇將帶你深入理解 MergeTree 是什麼、它解決了哪些問題，以及如何透過不同的變種引擎 (ReplacingMergeTree, SummingMergeTree 等) 應對不同資料處理場景。

## MergeTree 是什麼？

MergeTree 是 ClickHouse 中最基礎的儲存引擎，負責將大量寫入資料有效儲存與管理，並支援高效的查詢與資料合併（Merge）操作。

### 核心概念：

1. **分區 (Partitions)**：將資料依據指定欄位（如日期）切分成不同區塊，減少查詢時需掃描的資料量。

![](https://clickhouse.com/docs/assets/ideal-img/partitions.4c07acd.2048.png)

> [取自官網: Table partitions](https://clickhouse.com/docs/partitions)

2. **Primary Key (主鍵排序索引)**：定義資料在磁碟中的排序方式，讓查詢條件能快速定位資料範圍。
3. **Data Parts (資料片段)**：每次資料寫入時，都會生成一個 Data Part，經過以下手續：Sorting、Splitting、Compression，最後 Writing to Disk

![](https://clickhouse.com/docs/assets/ideal-img/part.d9b96ef.2048.png)

:::note
1. **Sorting**：資料根據 Sorting Key（如 town, street）進行排序，並產生一個稀疏主鍵索引（Sparse Primary Index）。
2. **Splitting**：排序後的資料會被拆分成單獨的欄位。
3. **Compression**：每個欄位分別進行壓縮處理，應用 LZ4、ZSTD 等壓縮算法。
:::

後續透過背景合併 (Merge) 將小片段整理成大型優化片段。

![](https://clickhouse.com/docs/assets/ideal-img/merges.285da65.2048.png)

> [取自官網: Table parts](https://clickhouse.com/docs/parts)

## MergeTree 的核心特性與 Merge 操作原理

MergeTree 家族的引擎具備以下幾個特性：

1. **Primary Key 排序與稀疏索引 (Sparse Primary Index)**：表格的主鍵決定了每個資料片段 (Data Part) 內的排序方式（Clustered Index）。不過，這個索引並不指向單筆資料，而是以 8192 筆資料為單位的 Granule (粒度)。這種設計讓主鍵索引即便在超大資料量下仍能被保留在記憶體中，並且能有效快速地存取磁碟上的資料區塊。

2. **靈活的分區機制 (Partitioning)**：使用任意表達式來劃分分區，並能透過 Partition Pruning 技術在查詢時自動跳過不相關的分區，避免不必要的 I/O。

3. **高可用性與容錯 (Replication)**：資料可於多個 Cluster Nodes 間進行複製，支援高可用性、故障切換 (Failover)、以及無停機升級 (Zero Downtime Upgrade)。

4. **統計與抽樣查詢 (Sampling & Statistics)**：MergeTree 支援各類型的統計與抽樣機制，可協助查詢優化器進行查詢路徑選擇與加速。

## MergeTree 解決了哪些問題？

* **大規模寫入效能瓶頸**：透過將寫入資料分為小型 Data Parts 先行儲存，避免頻繁修改大型檔案帶來的 I/O 開銷。
* **查詢效率提升**：依據 Partition 與 Primary Key 排序，能快速定位查詢資料區塊，避免全表掃描。
* **資料壓縮與去重整合**：透過 Merge 操作合併資料時進行壓縮與去重，大幅降低儲存空間與查詢延遲。

## MergeTree 家族的特殊變種

ClickHouse 根據不同業務需求，衍生出許多 MergeTree 變種引擎：

| 儲存引擎 | 特性與應用場景 |
| -------------------------------- | ---------------------------------------------- |
| **ReplacingMergeTree**| 自動以指定欄位 (如 version 欄位) 替換重複資料，適合資料需去重的場景。|
| **SummingMergeTree**| 在合併時自動將相同 Primary Key 的數值欄位進行加總，適用於資料匯總場景。|
| **AggregatingMergeTree**| 針對 AggregateFunction 資料型別做更複雜的聚合運算，適合實時指標統計場景。 |
| **CollapsingMergeTree**| 透過 sign 欄位標記資料新增/刪除狀態，自動實現邏輯刪除與衝突解決。|
| **VersionedCollapsingMergeTree** | 在 Collapsing 基礎上支援版本控制的資料去重。|

## Merge 操作的原理與效能影響

MergeTree 會在背景執行 Merge 操作，將多個小型 Data Part 合併成大型 Part，並在此過程中進行排序、壓縮與去重。

* **Merge 頻率與效能平衡**：Merge 操作會佔用系統 I/O 資源，設定合理的 Merge 參數（如 `max_parts_to_merge_at_once`）可平衡查詢與寫入效能。
* **Mutation (資料變異操作)**：ClickHouse 也支援在 Merge 階段進行 UPDATE / DELETE 操作，但屬於非即時性處理，適合資料分析場景。

## 應用場景

* **Log 分析**：以日期為 Partition，URL 或 IP 為 Primary Key，支援快速查詢特定時段與條件的日誌資料。
* **用戶行為追蹤資料**：透過 `ReplacingMergeTree` 去重資料、`SummingMergeTree` 快速整理使用者點擊行為。
* **IoT 感測資料平台**：大量寫入感測資料並以 `AggregatingMergeTree` 實時統計各種資料指標。

## 結語

MergeTree 是 ClickHouse 高效能儲存與查詢的基礎，透過分區、排序與背景 Merge 機制，使得海量資料寫入與查詢皆能達到極致效能。針對不同業務場景選擇合適的 MergeTree 變種引擎，能夠很大的提升系統性能。


### ClickHouse 系列持續更新中:

1. [ClickHouse 系列：ClickHouse 是什麼？與傳統 OLAP/OLTP 資料庫的差異](https://blog.vicwen.app/posts/what-is-clickhouse/)
2. [ClickHouse 系列：ClickHouse 為什麼選擇 Column-based 儲存？講解 Row-based 與 Column-based 的核心差異](https://blog.vicwen.app/posts/clickhouse-column-row-based-storage/)
3. [ClickHouse 系列：ClickHouse 儲存引擎 - MergeTree](https://blog.vicwen.app/posts/clickhouse-mergetree-engine)
4. [ClickHouse 系列：壓縮技術與 Data Skipping Indexes 如何大幅加速查詢](https://blog.vicwen.app/posts/clickhouse-compression-skipping-index/)
5. [ClickHouse 系列：ReplacingMergeTree 與資料去重機制](https://blog.vicwen.app/posts/clickhouse-replacingmergetree-deduplication/)
6. [ClickHouse 系列：SummingMergeTree 進行資料彙總的應用場景](https://blog.vicwen.app/posts/clickhouse-summingmergetree-aggregation/)
7. [ClickHouse 系列：Materialized Views 即時聚合查詢實戰](https://blog.vicwen.app/posts/clickhouse-materialized-view/)
8. [ClickHouse 系列：分區策略與 Partition Pruning 原理解析](https://blog.vicwen.app/posts/clickhouse-partition-pruning/)
9. [ClickHouse 系列：Primary Key、Sorting Key 與 Granule 索引運作原理](https://blog.vicwen.app/posts/clickhouse-primary-sorting-key/)
10. [ClickHouse 系列：CollapsingMergeTree 與邏輯刪除的最佳實踐](https://blog.vicwen.app/posts/clickhouse-collapsingmergetree/)
11. [ClickHouse 系列：VersionedCollapsingMergeTree 版本控制與數據衝突解決](https://blog.vicwen.app/posts/clickhouse-versioned-collapsingmergetree/)
12. [ClickHouse 系列：AggregatingMergeTree 實時指標統計的進階應用](https://blog.vicwen.app/posts/clickhouse-aggregatingmergetree/)
13. [ClickHouse 系列：Distributed Table 與分布式查詢架構](https://blog.vicwen.app/posts/clickhouse-distributed-table/)
14. [ClickHouse 系列：Replicated Tables 高可用性與零停機升級實作](https://blog.vicwen.app/posts/clickhouse-replication-failover/)
15. [ClickHouse 系列：與 Kafka 整合打造即時數據流處理管道](https://blog.vicwen.app/posts/clickhouse-kafka-streaming/)
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
