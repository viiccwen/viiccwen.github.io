---
title: ClickHouse 系列：批次匯入最佳實踐 (CSV、Parquet、Native Format)
published: 2025-08-19
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, 鐵人賽, Distributed]
category: 'software development'
draft: false 
lang: ''
---

在實務的資料分析與數倉場景中，批次匯入（Batch Import）是 ClickHouse 最常見的資料導入方式之一。
根據資料量、來源與格式的不同，選擇合適的匯入方法與檔案格式，能大幅提升匯入速度並降低資源消耗。

本篇將介紹三種常見格式：

* **CSV（通用文字格式）**
* **Parquet（列式壓縮格式）**
* **ClickHouse Native Format（原生二進位格式）**

## 匯入基本流程

在 ClickHouse 中，批次匯入最常透過以下方式進行：

1. **clickhouse-client** 命令行匯入（我是只有除錯用過啦...）
2. **HTTP 接口** (`INSERT INTO ... FORMAT`)
3. **外部工具**（如 `clickhouse-local`、ETL 工具、Python SDK）

無論使用哪種方式，都必須：

* 先建立目標表（Schema 必須與檔案結構一致）
* 使用適合的表引擎（MergeTree 系列最常用）

## 匯入 CSV 格式

### 適用場景

* 來源系統匯出為純文字檔
* 跨平台通用、容易查看與修改
* **不追求極致效能**，但需要易於整合

### 範例

```sql
CREATE TABLE events_csv
(
    event_date Date,
    user_id UInt64,
    action String
) ENGINE = MergeTree()
ORDER BY (event_date, user_id);
```

```bash
clickhouse-client --query="INSERT INTO events_csv FORMAT CSV" < events.csv
```

### 性能建議

* 加上 `--max_insert_block_size=1000000` 增加批次寫入大小
* 對於大檔案，可搭配 `gzip` 壓縮：

  ```bash
  zcat events.csv.gz | clickhouse-client --query="INSERT INTO events_csv FORMAT CSV"
  ```

## 匯入 Parquet 格式

### 適用場景

* 上游系統（Spark、Flink、Hive）已輸出列式格式
* 大型批量資料（GB～TB 級別）
* 希望保留類型資訊與壓縮率

### 範例

```sql
CREATE TABLE events_parquet
(
    event_date Date,
    user_id UInt64,
    action String
) ENGINE = MergeTree()
ORDER BY (event_date, user_id);
```

```bash
clickhouse-client --query="INSERT INTO events_parquet FORMAT Parquet" < events.parquet
```

### 性能建議

* Parquet 已壓縮，匯入時 CPU 壓力較高但 I/O 成本低
* 避免匯入過多小檔案（可先合併再匯入）
* 若檔案在雲端（S3），可直接用 `s3()` 函數載入：

  ```sql
  INSERT INTO events_parquet
  SELECT * FROM s3('https://bucket/file.parquet', 'AWS_KEY', 'AWS_SECRET', 'Parquet');
  ```

## 匯入 ClickHouse Native Format

### 適用場景

* ClickHouse 與 ClickHouse 之間的高速傳輸
* 追求最高效能（無需格式解析）
* 適合資料備份與還原

### 範例

```bash
clickhouse-client --query="SELECT * FROM events_csv FORMAT Native" > events.native
clickhouse-client --query="INSERT INTO events_native FORMAT Native" < events.native
```

### 性能建議

* 比 CSV/Parquet 更快，適合機器間資料搬遷
* 不適用於多資料源系統（僅限 ClickHouse）
* 可搭配 `clickhouse-backup` 工具全庫搬遷

## 效能最佳化策略

| 策略           | 說明                                  |
| ------------ | ----------------------------------- |
| **大批量一次性匯入** | 避免多次小批量 INSERT，減少寫入壓力               |
| **排序鍵對齊**    | 匯入資料順序與 `ORDER BY` 鍵一致，可降低 Merge 開銷 |
| **關閉索引檢查**   | 批次匯入前可暫時停用部分檢查（如 `constraints`）     |
| **分區分批匯入**   | 按日期或業務鍵切分檔案，平行匯入                    |

## 匯入方式比較

| 格式          | 優點        | 缺點              | 適用場景        |
| ----------- | --------- | --------------- | ----------- |
| **CSV**     | 通用、易讀、易產生 | 體積大、解析慢         | 系統間交換、小規模匯入 |
| **Parquet** | 壓縮率高、列式存儲 | 解析較耗 CPU        | 大資料批量匯入     |
| **Native**  | 匯入最快、無解析  | 僅 ClickHouse 可用 | 備份還原、集群遷移   |

## 總結

* **小量資料** → CSV，方便整合與檢查
* **大資料批次匯入** → Parquet，減少 I/O 與存儲空間
* **ClickHouse 內部傳輸** → Native，最高效能

若批次匯入頻繁，可以搭配 **分區策略（Partitioning）** 與 **分批併發匯入**，進一步縮短導入時間。

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

