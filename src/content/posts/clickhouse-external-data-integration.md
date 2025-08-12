---
title: ClickHouse 系列：ClickHouse 與外部資料源整合（PostgreSQL）
published: 2025-08-20
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, 鐵人賽, Distributed]
category: 'software development'
draft: false 
lang: ''
---

在實際數據平台架構中，ClickHouse 通常不是唯一的資料庫，而是與其他資料源（如 MySQL、PostgreSQL、S3、Kafka 等）整合，扮演 **高效查詢與分析層** 的角色。

本篇將示範如何透過 **PostgreSQL Table Engine** 和 **MaterializedPostgreSQL Database Engine (experimental)**，讓 ClickHouse 直接查詢 PostgreSQL 資料，實現跨庫即時分析。

## 為什麼要整合 PostgreSQL？

在許多應用場景中，PostgreSQL 作為 **OLTP 系統** 儲存業務資料（如交易、用戶、訂單），但在報表分析時遇到以下挑戰：

* OLTP 查詢性能無法滿足大量聚合分析
* 避免 ETL 搬運延遲帶來的資料不一致
* 不想複製全量資料，只需要即時查詢部分資料

ClickHouse 的 **PostgreSQL Table Engine** 可直接連線 PostgreSQL，並以類似「外部表」的方式查詢資料，適合快速整合多方資料源。

## PostgreSQL Table Engine — 即時雙向查詢與插入

### 適用情境

* 不需全量同步，只想即時查詢 PostgreSQL 資料
* 需要在 ClickHouse 直接插入資料回 PostgreSQL
* 資料量相對較小、即時性需求高

### PostgreSQL 端設定

1. **允許網路連線**

   ```conf
   # postgresql.conf
   listen_addresses = '*'
   ```

2. **建立使用者**

   ```sql
   CREATE ROLE clickhouse_user SUPERUSER LOGIN PASSWORD 'ClickHouse_123';
   ```

3. **建立資料庫與表**

   ```sql
   CREATE DATABASE db_in_psg;

   CREATE TABLE table1 (
       id integer primary key,
       column1 varchar(10)
   );

   INSERT INTO table1 VALUES (1, 'abc'), (2, 'def');
   ```

4. **設定連線權限**

   ```conf
   # pg_hba.conf
   host    db_in_psg  clickhouse_user  192.168.1.0/24  password
   ```

5. **重新載入設定**

   ```bash
   pg_ctl reload
   ```

---

### ClickHouse 端設定

1. **建立資料庫**

   ```sql
   CREATE DATABASE db_in_ch;
   ```

2. **建立連線表**

   ```sql
   CREATE TABLE db_in_ch.table1
   (
       id UInt64,
       column1 String
   )
   ENGINE = PostgreSQL(
       'postgres-host.domain.com:5432',
       'db_in_psg',
       'table1',
       'clickhouse_user',
       'ClickHouse_123'
   );
   ```

3. **測試查詢**

   ```sql
   SELECT * FROM db_in_ch.table1;
   ```

4. **雙向測試**

   * 在 PostgreSQL 新增資料，ClickHouse 查得到
   * 在 ClickHouse 新增資料，PostgreSQL 查得到

---

## MaterializedPostgreSQL Database Engine — 持續資料同步（CDC）

### 適用情境

* 需要將 PostgreSQL 整個資料庫或多個表持續同步到 ClickHouse
* 資料更新頻率高
* 適合報表與即時分析

### 注意事項

* **實驗功能**，需啟用設定
* 不支援 ClickHouse 直接修改同步表（避免與 CDC 衝突）
* 適合用於 **只讀分析** 場景

---

### PostgreSQL 端設定

1. **開啟複製功能**

   ```conf
   # postgresql.conf
   listen_addresses = '*'
   max_replication_slots = 10
   wal_level = logical
   ```

2. **建立使用者與資料庫**

   ```sql
   CREATE ROLE clickhouse_user SUPERUSER LOGIN PASSWORD 'ClickHouse_123';
   CREATE DATABASE db1;
   ```

3. **建立表與資料**

   ```sql
   \connect db1
   CREATE TABLE table1 (
       id integer primary key,
       column1 varchar(10)
   );
   INSERT INTO table1 VALUES (1, 'abc'), (2, 'def');
   ```

4. **設定權限**

   ```conf
   # pg_hba.conf
   host    db1  clickhouse_user  192.168.1.0/24  password
   ```

---

### ClickHouse 端設定

1. **啟用實驗功能**

   ```sql
   SET allow_experimental_database_materialized_postgresql=1;
   ```

2. **建立同步資料庫**

   ```sql
   CREATE DATABASE db1_postgres
   ENGINE = MaterializedPostgreSQL(
       'postgres-host.domain.com:5432',
       'db1',
       'clickhouse_user',
       'ClickHouse_123'
   )
   SETTINGS materialized_postgresql_tables_list = 'table1';
   ```

3. **驗證資料**

   ```sql
   SELECT * FROM db1_postgres.table1;
   ```

4. **測試同步**
   在 PostgreSQL 新增資料，ClickHouse 會自動更新。

---

## 選擇策略建議

| 特性    | PostgreSQL Table Engine | MaterializedPostgreSQL |
| ----- | ----------------------- | ---------------------- |
| 存取方式  | 即時查詢與寫入                 | 持續複製（只讀）               |
| 適合資料量 | 小批量、查詢即時                | 大批量、長期分析               |
| 延遲    | 查詢即時（依 PostgreSQL 響應）   | 低延遲（CDC 同步）            |
| 使用限制  | 受限於 PostgreSQL 性能       | 實驗功能、不可寫入              |

## 運作機制與限制

### 優點

* 即時查詢 PostgreSQL，不需先 ETL
* 可與 ClickHouse 原生表 Join
* 適合低延遲資料整合需求

### 限制

* 查詢效能受限於 PostgreSQL 回應速度
* 大量資料掃描時延遲較高
* 適合即時查詢小批量資料，不適合全量大表分析
  （建議使用 `clickhouse-copier` 或 ETL 工具將歷史資料導入 ClickHouse）

## 總結

透過 PostgreSQL Table Engine，ClickHouse 可以直接訪問 PostgreSQL 的即時資料，實現跨系統分析，特別適合混合查詢與即時 BI 報表需求。

在實務中，建議：

* 大表做 ETL 導入 ClickHouse
* 小表 / 最新資料透過外部表查詢
* 結合 Materialized View 進行即時彙總

#### ClickHouse 系列持續更新中:

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

