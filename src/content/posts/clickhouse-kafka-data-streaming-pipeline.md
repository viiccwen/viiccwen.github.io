---
title: ClickHouse 系列：與 Kafka 整合打造即時 Data Streaming Pipeline
published: 2025-08-18
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, 鐵人賽, Distributed]
category: 'software development'
draft: false 
lang: ''
---

在大規模資料場景下，企業越來越需要能夠 **實時處理與分析 Data Streaming** 的技術架構。
而 ClickHouse 天生與 Kafka 的整合，提供了一條高效能的 **Event Streaming → Real-Time Analytics** Data Pipeline，讓資料從產生到分析僅需「秒級延遲」。

今天我們會透過專案帶各位了解 Kafka + ClickHouse 的即時 Data Streaming Pipeline，各位可以先將 [Repository Clone](https://github.com/viiccwen/kafka-clickhouse-data-streaming-pipeline) 下來，接下來我們都會用檔案內的內容來教學。


## 架構概念：Kafka + ClickHouse Data Streaming Pipeline

| 流程階段                                    | 說明                                 |
| --------------------------------------- | ---------------------------------- |
| Producers                               | 產生 Data Streaming 的上游系統（如 Web 行為、IoT、APM 等）。    |
| Kafka Topics                            | 接收 Data Streaming 的 Message Queue，具備高吞吐、可重播特性。            |
| Kafka Connect / ClickHouse Kafka Engine | 負責將 Kafka Topic 資料持續寫入 ClickHouse。 |
| ClickHouse Tables                       | 儲存與實時分析，可搭配 Materialized View、Partitioning 設計加速查詢。      |


## ClickHouse 與 Kafka 整合方式

### 方式一：Kafka Engine (ClickHouse 原生)

* ClickHouse 內建支援 Kafka Engine，可將 Kafka Topic 當作虛擬表來查詢。
* 適合 **低延遲場景**，資料可以邊讀邊寫入 ClickHouse MergeTree 表格。

### 方式二：Kafka Connect + ClickHouse Sink Connector

* 透過 Kafka Connect 架設 ETL Pipeline，使用 ClickHouse Sink Connector 自動將資料流寫入 ClickHouse。
* 適合 **Data Streaming轉管道標準化需求** (與其他資料平台共用 Kafka Connect 架構)。


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

## 實作環節

該專案已經使用 Docker Compose 將所有服務和設定都處理好了，各位可以簡單使用。

首先我們看到 `create_tables.sql`，這是我們建立 Kafka + ClickHouse 的關鍵。

### `create_tables.sql`

#### 1. 資料表清理
```sql
// create_tables.sql

-- ClickHouse Tables Setup
DROP TABLE IF EXISTS default.user_events;
DROP TABLE IF EXISTS default.kafka_user_events;
DROP TABLE IF EXISTS default.kafka_to_events_mv;
```

#### 2. 建立主資料表 `user_events`
```sql
// create_tables.sql
-- Main Events Table
CREATE TABLE IF NOT EXISTS default.user_events
(
    UserID UInt64,
    Action String,
    EventDate DateTime,
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(EventDate)
ORDER BY (UserID, EventDate);
```

#### 3. 建立 Kafka 接收表 `kafka_user_events`
```sql
// create_tables.sql
-- Kafka Engine Table
CREATE TABLE IF NOT EXISTS default.kafka_user_events
(
    UserID UInt64,
    Action String,
    EventDate DateTime,
) ENGINE = Kafka()
SETTINGS
    kafka_broker_list = 'kafka:29092',
    kafka_topic_list = 'user_events_topic',
    kafka_group_name = 'clickhouse_consumer_v3',
    kafka_format = 'JSONEachRow',
    kafka_num_consumers = 1,
    kafka_thread_per_consumer = 1;
```

這是一張 Kafka Engine Table，**本身不會儲存資料**，而是作為 ClickHouse 消費 Kafka 訊息的入口

:::warning
Kafka 表本身無法直接查詢。你必須透過 Materialized View 將資料寫入實體表才能存取。
:::

#### 4. 建立 Materialized View

這是整個 Streaming Pipeline 的關鍵橋樑。Materialized View 會監聽 kafka_user_events，並將其每筆資料**自動寫入**目標表 user_events。

* 使用 `TO default.user_events` 表示這是一個「推送型」 MV。
* SELECT 子句決定要寫入的資料欄位，需與目標表 schema 相符。
* 不需要手動執行 INSERT，資料會**自動同步**。

```sql
// create_tables.sql
-- Materialized View to stream data from Kafka to main table
CREATE MATERIALIZED VIEW IF NOT EXISTS default.kafka_to_events_mv TO default.user_events AS
SELECT 
    UserID,
    Action,
    EventDate,
FROM default.kafka_user_events; 
```

### `kafka_producer.py`

```py
import json
import time
from kafka import KafkaProducer
from datetime import datetime
import random

# Kafka Config
KAFKA_BROKER = 'localhost:9092'
TOPIC = 'user_events_topic'

# Initialize Kafka Producer
producer = KafkaProducer(
    bootstrap_servers=[KAFKA_BROKER],
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)

# Generate Random Events
def generate_event():
    return {
        "EventDate": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        "UserID": random.randint(0, 10),
        "Action": random.choice(["click", "view", "purchase"]),
        "Version": 1
    }

# Produce Events Continuously
def produce():
    print("Starting Kafka Producer...")
    try:
        while True:
            event = generate_event()
            producer.send(TOPIC, value=event)
            producer.flush() # NOTEICED: it'll be cache default, so we flush it
            print(f"Produced: {event}")
            time.sleep(1)  # Send 1 message per second (adjust as needed)
    except KeyboardInterrupt:
        print("Stopped Producer.")
    finally:
        producer.close()

if __name__ == "__main__":
    produce()
```

* 每秒送出一筆事件資料到 Kafka。
* `producer.flush()` 確保訊息立即送出（預設會暫存）。
* `time.sleep(1)` 控制發送頻率，可改成更快或更慢。

### clickhouse_query.py

```py
import clickhouse_connect

# ClickHouse Config
CLICKHOUSE_HOST = 'localhost'
CLICKHOUSE_PORT = 8123

def connect_clickhouse():
    """connect to ClickHouse"""
    try:
        client = clickhouse_connect.get_client(
            host=CLICKHOUSE_HOST,
            port=CLICKHOUSE_PORT,
            username='default',
            password='default'
        )
        print("connected to ClickHouse!")
        return client
    except Exception as e:
        print(f"connect to ClickHouse failed: {e}")
        return None

def check_tables(client):
    """check tables"""
    try:
        result = client.query("SHOW TABLES")
        print("existing tables:")
        for row in result.result_rows:
            print(f"  - {row[0]}")
        return True
    except Exception as e:
        print(f"check tables failed: {e}")
        return False

def query_data(client):
    """query data"""
    try:
        # query total records
        count_result = client.query("SELECT COUNT(*) FROM default.user_events")
        total_count = count_result.result_rows[0][0]
        print(f"\ntotal records: {total_count}")
        
        if total_count > 0:
            # query recent 10 records
            recent_result = client.query("""
                SELECT EventDate, UserID, Action 
                FROM default.user_events 
                ORDER BY EventDate DESC 
                LIMIT 10
            """)
            
            print("\nrecent 10 records:")
            print("-" * 60)
            for row in recent_result.result_rows:
                print(f"  {row[0]} | UserID: {row[1]} | Action: {row[2]}")
        
        # group by Action
        action_stats = client.query("""
            SELECT Action, COUNT(*) as count 
            FROM default.user_events 
            GROUP BY Action 
            ORDER BY count DESC
        """)
        
        print("\ngroup by Action:")
        print("-" * 30)
        for row in action_stats.result_rows:
            print(f"  {row[0]}: {row[1]} records")
            
    except Exception as e:
        print(f"query data failed: {e}")

def main():
    print("ClickHouse data query tool")
    print("=" * 40)
    
    client = connect_clickhouse()
    if client:
        check_tables(client)
        query_data(client)
        client.close()

if __name__ == "__main__":
    main() 
```

* 預設使用 HTTP port 8123
* 用戶名稱與密碼皆為 default，若 ClickHouse 有啟用 RBAC，這邊要對應調整

:::note
我們會在後面的文章中講到 RBAC
:::

接著我們使用 SQL Query 取得被 MV 轉發的資料。

```sql
-- 查詢最近 10 筆
SELECT EventDate, UserID, Action 
FROM default.user_events 
ORDER BY EventDate DESC 
LIMIT 10

-- Group by 統計
SELECT Action, COUNT(*) 
FROM default.user_events 
GROUP BY Action 
ORDER BY count DESC
```

## 結語

ClickHouse 與 Kafka 的整合，使我們能夠在毫秒級時間內，將龐大的事件資料流進行儲存、轉換與查詢分析。
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
17. [ClickHouse 系列：ClickHouse 與外部資料源整合（PostgreSQL）](https://blog.vicwen.app/posts/clickhouse-external-data-integration/)
18. [ClickHouse 系列：如何提升查詢優化？system.query_log 與 EXPLAIN 用法](https://blog.vicwen.app/posts/clickhouse-query-log-explain/)
19. [ClickHouse 系列：Projections 進階查詢加速技術](https://blog.vicwen.app/posts/clickhouse-projections-optimization/)
20. [ClickHouse 系列：Sampling 抽樣查詢與統計技術原理](https://blog.vicwen.app/posts/clickhouse-sampling-statistics/)
21. [ClickHouse 系列：TTL 資料清理與儲存成本優化](https://blog.vicwen.app/posts/clickhouse-ttl-storage-management/)
22. [ClickHouse 系列：儲存政策（Storage Policies）與磁碟資源分層策略](https://blog.vicwen.app/posts/clickhouse-storage-policies/)
23. [ClickHouse 系列：表格設計與儲存優化細節](https://blog.vicwen.app/posts/clickhouse-schemas-storage-improvement/)
24. [ClickHouse 系列：ClickHouse 系列：整合 Grafana 打造可視化監控](https://blog.vicwen.app/posts/clickhouse-grafana-dashboard/)
25. [ClickHouse 系列：查詢優化案例](https://blog.vicwen.app/posts/clickhouse-select-optimization/)
26. [ClickHouse 系列：與 BI 工具整合（Power BI）](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
27. [ClickHouse 系列：ClickHouse Cloud 與自建部署的優劣比較](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
28. [ClickHouse 系列：資料庫安全性與權限管理（RBAC）實作](https://blog.vicwen.app/posts/clickhouse-security-rbac/)
29. [ClickHouse 系列：Kubernetes 部署分散式架構](https://blog.vicwen.app/posts/clickhouse-operator-kubernates/)
30. [ClickHouse 系列：從原始碼看 MergeTree 的七大核心機制](https://blog.vicwen.app/posts/clickhouse-mergetree-sourcecode-introduction/)