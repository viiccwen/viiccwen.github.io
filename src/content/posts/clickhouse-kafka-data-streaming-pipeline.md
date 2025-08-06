---
title: ClickHouse 系列：與 Kafka 整合打造即時 Data Streaming Pipeline
published: 2025-08-20
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, Distributed]
category: 'software development'
draft: true 
lang: ''
---

在大規模資料場景下，企業越來越需要能夠 **實時處理與分析 Data Streaming** 的技術架構。
而 ClickHouse 天生與 Kafka 的整合，提供了一條高效能的 **Event Streaming → Real-Time Analytics** Data Pipeline，讓資料從產生到分析僅需「秒級延遲」。


## 架構概念：Kafka + ClickHouse Data Streaming Pipeline

![](https://your-image-link/pipeline.png) ← (我可以幫你畫)

| 流程階段                                    | 說明                                 |
| --------------------------------------- | ---------------------------------- |
| Producers                               | 產生事件流的上游系統（如 Web 行為、IoT、APM 等）。    |
| Kafka Topics                            | 承載資料流的事件佇列，具備高吞吐、可重播特性。            |
| Kafka Connect / ClickHouse Kafka Engine | 負責將 Kafka Topic 資料持續寫入 ClickHouse。 |
| ClickHouse Tables                       | 儲存與分析實時資料流，可搭配物化檢視表、分區設計加速查詢。      |


## ClickHouse 與 Kafka 整合方式

### 方式一：Kafka Engine (ClickHouse 原生)

* ClickHouse 內建支援 Kafka Engine，可將 Kafka Topic 當作虛擬表來查詢。
* 適合 **低延遲場景**，資料可以邊讀邊寫入 ClickHouse MergeTree 表格。

### 方式二：Kafka Connect + ClickHouse Sink Connector

* 透過 Kafka Connect 架設 ETL Pipeline，使用 ClickHouse Sink Connector 自動將資料流寫入 ClickHouse。
* 適合 **資料流轉管道標準化需求** (與其他資料平台共用 Kafka Connect 架構)。


## 語法 & 範例 & 參數定義

```sql
CREATE TABLE [IF NOT EXISTS] [db.]table_name [ON CLUSTER cluster]
(
    name1 [type1] [ALIAS expr1],
    name2 [type2] [ALIAS expr2],
    ...
) ENGINE = Kafka()
SETTINGS
    kafka_broker_list = 'host:port',
    kafka_topic_list = 'topic1,topic2,...',
    kafka_group_name = 'group_name',
    kafka_format = 'data_format'[,]
    [kafka_security_protocol = '',]
    [kafka_sasl_mechanism = '',]
    [kafka_sasl_username = '',]
    [kafka_sasl_password = '',]
    [kafka_schema = '',]
    [kafka_num_consumers = N,]
    [kafka_max_block_size = 0,]
    [kafka_skip_broken_messages = N,]
    [kafka_commit_every_batch = 0,]
    [kafka_client_id = '',]
    [kafka_poll_timeout_ms = 0,]
    [kafka_poll_max_batch_size = 0,]
    [kafka_flush_interval_ms = 0,]
    [kafka_thread_per_consumer = 0,]
    [kafka_handle_error_mode = 'default',]
    [kafka_commit_on_select = false,]
    [kafka_max_rows_per_message = 1];
```

```sql
CREATE TABLE queue (
  timestamp UInt64,
  level String,
  message String
) ENGINE = Kafka('localhost:9092', 'topic', 'group1', 'JSONEachRow');

SELECT * FROM queue LIMIT 5;

CREATE TABLE queue2 (
  timestamp UInt64,
  level String,
  message String
) ENGINE = Kafka SETTINGS kafka_broker_list = 'localhost:9092',
                          kafka_topic_list = 'topic',
                          kafka_group_name = 'group1',
                          kafka_format = 'JSONEachRow',
                          kafka_num_consumers = 4;

CREATE TABLE queue3 (
  timestamp UInt64,
  level String,
  message String
) ENGINE = Kafka('localhost:9092', 'topic', 'group1')
            SETTINGS kafka_format = 'JSONEachRow',
                     kafka_num_consumers = 4;
```

### 必要參數

| 參數名                     | 說明                                               |
| ----------------------- | ------------------------------------------------ |
| **kafka\_broker\_list** | Kafka Broker 位址與 Port，支援多節點（逗號分隔）。               |
| **kafka\_topic\_list**  | 監聽的 Kafka Topic 名稱，支援多個 Topic（逗號分隔）。             |
| **kafka\_group\_name**  | Consumer Group 名稱，ClickHouse 會以這個 Group 協調消費者進度。 |
| **kafka\_format**       | 資料格式，如 JSONEachRow、CSV、Avro、Protobuf 等。          |

### 安全性認證設定

| 參數名                           | 說明                                                 |
| ----------------------------- | -------------------------------------------------- |
| **kafka\_security\_protocol** | 設定連線安全協定 (如 PLAINTEXT, SSL, SASL\_SSL 等)。          |
| **kafka\_sasl\_mechanism**    | SASL 認證方式 (如 PLAIN, SCRAM-SHA-256, SCRAM-SHA-512)。 |
| **kafka\_sasl\_username**     | SASL 認證用戶名稱。                                       |
| **kafka\_sasl\_password**     | SASL 認證密碼。                                         |
| **kafka\_schema**             | 若使用 Avro/Protobuf/Cap’n Proto 格式時，需指定 Schema 檔案路徑。 |

### 效能與吞吐量控制

| 參數名                               | 說明                                                                 |
| --------------------------------- | ------------------------------------------------------------------ |
| **kafka\_num\_consumers**         | 這張表會啟用的 Consumer 數量。建議設定不超過 Topic Partition 數量與伺服器 CPU 核心數。        |
| **kafka\_max\_block\_size**       | 每次 Poll Kafka 拉取的最大訊息數量 (預設為 ClickHouse max\_insert\_block\_size)。 |
| **kafka\_poll\_max\_batch\_size** | 每次 Kafka poll 最大訊息批次量。與 kafka\_max\_block\_size 類似，雙方限制取較小者。       |
| **kafka\_poll\_timeout\_ms**      | Kafka poll 的超時時間。預設為 stream\_poll\_timeout\_ms。                    |
| **kafka\_flush\_interval\_ms**    | Flush 資料到 ClickHouse 的間隔時間 (毫秒)。預設為 stream\_flush\_interval\_ms。   |
| **kafka\_thread\_per\_consumer**  | 設為 1 時，會為每個 Consumer 啟動獨立執行緒，並行寫入，適合多 Partition 場景。                |

### 容錯與錯誤處理

| 參數名                               | 說明                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **kafka\_skip\_broken\_messages** | 允許每個批次 (Block) 最多跳過 N 筆無法解析的錯誤訊息 (格式錯誤等)。預設為 0。                                                       |
| **kafka\_handle\_error\_mode**    | 錯誤處理模式：default (直接拋錯)、stream (錯誤記錄在虛擬欄位 \_error)、dead\_letter\_queue (寫入 system.dead\_letter\_queue)。 |
| **kafka\_commit\_every\_batch**   | 每處理完一個 Batch 就 Commit Offset，預設為 0 (整個 Block 完成才 Commit)。                                             |
| **kafka\_commit\_on\_select**     | 是否在 SELECT 查詢時 Commit Offset，預設為 false。                                                               |

### 資料處理細節

| 參數名                                | 說明                                          |
| ---------------------------------- | ------------------------------------------- |
| **kafka\_max\_rows\_per\_message** | 針對 row-based 格式，每個 Kafka 訊息最大可包含幾筆資料。預設為 1。 |

### 一些實務上的設定

| 場景                       | 推薦設定                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| 高吞吐量 (大量 Partition, 高頻率) | kafka\_num\_consumers = Partition 數，kafka\_thread\_per\_consumer = 1 |
| 敏感錯誤容忍 (格式錯誤需記錄)         | kafka\_handle\_error\_mode = 'stream'                                |
| 大批次穩定寫入                  | kafka\_max\_block\_size 與 kafka\_poll\_max\_batch\_size 設為 10萬或更多    |
| 跨 DC 資料同步                | 適當延長 kafka\_poll\_timeout\_ms 與 kafka\_flush\_interval\_ms，確保網路環境適應性 |

## 實作：Kafka Engine + Materialized View 快速上手

### 2. 建立目標 MergeTree Table

```sql
CREATE TABLE user_actions (
    EventDate DateTime,
    UserID UInt64,
    Action String
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(EventDate)
ORDER BY (UserID, EventDate);
```


### 3. 透過 Materialized View 進行持續寫入

```sql
CREATE MATERIALIZED VIEW mv_user_actions TO user_actions AS
SELECT
    EventDate,
    UserID,
    Action
FROM kafka_events;
```

這樣 Kafka Topic 中的資料一旦有新事件，ClickHouse 會即時將資料寫入 `user_actions` 表格中，達到 **實時資料入庫**。


## 效能與穩定性建議

| 項目                         | 說明                                      |
| -------------------------- | --------------------------------------- |
| Partition Key 設計           | 依據時間或業務邏輯切分 Partition，減少掃描範圍。           |
| 批次大小 (Batch Size)          | 控制每次從 Kafka 拉取的訊息批次，避免小批次大量寫入造成 I/O 壓力。 |
| 消費延遲 (poll\_interval\_ms)  | 可調整拉取 Kafka 訊息的頻率，以平衡延遲與資源消耗。           |
| 資料格式 (JSONEachRow vs Avro) | Avro 更適合結構化且欄位穩定的大規模資料流，效能較佳。           |
| 避免使用 FINAL 查詢              | 實時流資料應透過表結構設計避免查詢時需要用 FINAL 強制去重。       |


## 實務應用場景

| 應用情境          | 說明                                     |
| ------------- | -------------------------------------- |
| Web 即時行為分析    | 使用 Kafka 收集點擊流事件，ClickHouse 實時統計分析。    |
| IoT 大規模感測資料平台 | 透過 Kafka 將設備資料流式傳輸進 ClickHouse，支援即時監測。 |
| APM 監控與異常偵測平台 | 將應用日誌與指標流式處理至 ClickHouse，實現秒級可視化。      |


## 結語

ClickHouse 與 Kafka 的整合，使我們能夠在毫秒級時間內，將龐大的事件資料流進行存儲、轉換與查詢分析。
透過 Materialized View 與 Kafka Engine，從資料進來到 BI 報表呈現，整個過程都能保持高效能且可擴展的設計。

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
