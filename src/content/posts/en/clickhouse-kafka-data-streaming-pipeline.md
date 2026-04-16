---
title: "ClickHouse Series: Building a Real-Time Data Streaming Pipeline with Kafka"
published: 2025-08-18
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: ["ClickHouse", "Database", "Ironman", "Distributed"]
category: 'software development'
draft: false
lang: 'en'
---

In large-scale data scenarios, companies increasingly need architecture that can **process and analyze streaming data in real time**.
Because ClickHouse integrates naturally with Kafka, it provides a high-performance **Event Streaming → Real-Time Analytics** data pipeline, letting data move from production to analysis with only **second-level latency**.

Today, we will use a project to walk through a real-time Kafka + ClickHouse streaming pipeline. You can start by cloning the [repository](https://github.com/viiccwen/kafka-clickhouse-data-streaming-pipeline), and the rest of this article will use the files in that project as examples.


## Architecture Overview: Kafka + ClickHouse Data Streaming Pipeline

| Pipeline Stage                            | Description                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| Producers                                 | Upstream systems that generate streaming data, such as web behavior, IoT, or APM |
| Kafka Topics                              | The message queue layer that receives streaming data, with high throughput and replay support |
| Kafka Connect / ClickHouse Kafka Engine   | Continuously writes Kafka topic data into ClickHouse                        |
| ClickHouse Tables                         | Stores data and supports real-time analytics, often paired with Materialized Views and partitioning for faster queries |


## Ways to Integrate ClickHouse with Kafka

### Option 1: Kafka Engine (Native ClickHouse)

* ClickHouse has built-in support for Kafka Engine, which lets Kafka topics be treated like virtual tables.
* This is suitable for **low-latency scenarios**, where data can be read and written into ClickHouse MergeTree tables in near real time.

### Option 2: Kafka Connect + ClickHouse Sink Connector

* Build the ETL pipeline with Kafka Connect and use the ClickHouse Sink Connector to write streams into ClickHouse automatically.
* This is suitable when you want a **standardized data streaming pipeline**, especially if the rest of your data platform already uses Kafka Connect.


## Syntax, Example, and Parameter Definitions

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


### Required Parameters

| Parameter               | Description                                                                 |
| ----------------------- | --------------------------------------------------------------------------- |
| **kafka\_broker\_list** | Kafka broker addresses and ports. Multiple nodes are supported, separated by commas |
| **kafka\_topic\_list**  | Kafka topics to subscribe to. Multiple topics are supported, separated by commas |
| **kafka\_group\_name**  | Consumer group name. ClickHouse uses this group to coordinate consumer progress |
| **kafka\_format**       | Data format such as `JSONEachRow`, `CSV`, `Avro`, or `Protobuf`            |

### Security and Authentication Settings

| Parameter                         | Description                                                                 |
| --------------------------------- | --------------------------------------------------------------------------- |
| **kafka\_security\_protocol**     | Connection security protocol such as `PLAINTEXT`, `SSL`, or `SASL_SSL`     |
| **kafka\_sasl\_mechanism**        | SASL authentication mechanism such as `PLAIN`, `SCRAM-SHA-256`, or `SCRAM-SHA-512` |
| **kafka\_sasl\_username**         | SASL username                                                               |
| **kafka\_sasl\_password**         | SASL password                                                               |
| **kafka\_schema**                 | Required schema file path when using formats such as Avro, Protobuf, or Cap’n Proto |

### Performance and Throughput Controls

| Parameter                           | Description                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------- |
| **kafka\_num\_consumers**           | Number of consumers enabled for this table. Recommended not to exceed the topic partition count or CPU core count |
| **kafka\_max\_block\_size**         | Maximum number of messages fetched from Kafka per poll. Defaults to ClickHouse `max_insert_block_size` |
| **kafka\_poll\_max\_batch\_size**   | Maximum Kafka batch size per poll. Similar to `kafka_max_block_size`; the smaller limit wins |
| **kafka\_poll\_timeout\_ms**        | Timeout for Kafka polls. Defaults to `stream_poll_timeout_ms`               |
| **kafka\_flush\_interval\_ms**      | Interval in milliseconds for flushing data into ClickHouse. Defaults to `stream_flush_interval_ms` |
| **kafka\_thread\_per\_consumer**    | If set to `1`, each consumer gets its own thread and can write in parallel, which works well for multiple partitions |

### Fault Tolerance and Error Handling

| Parameter                           | Description                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------- |
| **kafka\_skip\_broken\_messages**   | Maximum number of malformed messages to skip per block. Defaults to `0`     |
| **kafka\_handle\_error\_mode**      | Error mode: `default` (throw immediately), `stream` (record errors in virtual column `_error`), or `dead_letter_queue` (write to `system.dead_letter_queue`) |
| **kafka\_commit\_every\_batch**     | Commit offsets after each batch. Defaults to `0`, meaning commit after the entire block finishes |
| **kafka\_commit\_on\_select**       | Whether to commit offsets during `SELECT`. Defaults to `false`              |

### Data Processing Detail

| Parameter                            | Description                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------- |
| **kafka\_max\_rows\_per\_message**   | For row-based formats, the maximum number of rows a single Kafka message can contain. Defaults to `1` |

### Some Practical Config Recommendations

| Scenario                         | Recommended Setting                                                         |
| -------------------------------- | --------------------------------------------------------------------------- |
| High throughput (many partitions, high frequency) | `kafka_num_consumers =` partition count, `kafka_thread_per_consumer = 1` |
| Sensitive error tolerance (need to record bad messages) | `kafka_handle_error_mode = 'stream'`                               |
| Stable large-batch writes        | Set `kafka_max_block_size` and `kafka_poll_max_batch_size` to 100,000 or more |
| Cross-DC data synchronization    | Increase `kafka_poll_timeout_ms` and `kafka_flush_interval_ms` appropriately to fit network conditions |

## Implementation Walkthrough

This project already uses Docker Compose to set up all services and configuration, so it is easy to run.

First, look at `create_tables.sql`, which is the key file for setting up Kafka + ClickHouse.

### `create_tables.sql`

#### 1. Table Cleanup
```sql
// create_tables.sql

-- ClickHouse Tables Setup
DROP TABLE IF EXISTS default.user_events;
DROP TABLE IF EXISTS default.kafka_user_events;
DROP TABLE IF EXISTS default.kafka_to_events_mv;
```

#### 2. Create the Main Table `user_events`
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

#### 3. Create the Kafka Intake Table `kafka_user_events`
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

This is a Kafka Engine table. **It does not store data itself**. Instead, it acts as the entry point for ClickHouse to consume Kafka messages.

:::warning
You cannot directly query a Kafka table for persistent data. You must write the data into a physical table through a Materialized View.
:::

#### 4. Create the Materialized View

This is the key bridge in the whole streaming pipeline. The Materialized View listens to `kafka_user_events` and **automatically writes** each row into the target table `user_events`.

* Using `TO default.user_events` means this is a push-style MV.
* The `SELECT` clause determines which columns will be written, and it must match the schema of the target table.
* No manual `INSERT` is needed. Data is **forwarded automatically**.

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

* Sends one event to Kafka every second.
* `producer.flush()` ensures the message is sent immediately instead of staying buffered.
* `time.sleep(1)` controls the sending frequency and can be adjusted.

### `clickhouse_query.py`

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

* Uses HTTP port `8123` by default
* The username and password are both `default`. If RBAC is enabled in ClickHouse, this should be adjusted accordingly

:::note
We will talk about RBAC in a later article.
:::

Next, we use SQL queries to fetch the data forwarded by the MV.

```sql
-- Query the most recent 10 records
SELECT EventDate, UserID, Action 
FROM default.user_events 
ORDER BY EventDate DESC 
LIMIT 10

-- Group by statistics
SELECT Action, COUNT(*) 
FROM default.user_events 
GROUP BY Action 
ORDER BY count DESC
```

## Conclusion

The integration between ClickHouse and Kafka makes it possible to store, transform, and analyze large event streams with very low latency.
By combining Materialized Views and Kafka Engine, the entire path from ingestion to BI reporting can remain both high-performance and scalable.

### More ClickHouse Series Posts Coming:

1. [ClickHouse Series: What Is ClickHouse? Differences from Traditional OLAP/OLTP Databases](https://blog.vicwen.app/posts/what-is-clickhouse/)
2. [ClickHouse Series: Why ClickHouse Uses Column-Based Storage? A Core Comparison of Row-Based and Column-Based Storage](https://blog.vicwen.app/posts/clickhouse-column-row-based-storage/)
3. [ClickHouse Series: ClickHouse Storage Engine - MergeTree](https://blog.vicwen.app/posts/clickhouse-mergetree-engine)
4. [ClickHouse Series: How Compression and Data Skipping Indexes Greatly Speed Up Queries](https://blog.vicwen.app/posts/clickhouse-compression-skipping-index/)
5. [ClickHouse Series: ReplacingMergeTree and the Data Deduplication Mechanism](https://blog.vicwen.app/posts/clickhouse-replacingmergetree-deduplication/)
6. [ClickHouse Series: Use Cases for Data Aggregation with SummingMergeTree](https://blog.vicwen.app/posts/clickhouse-summingmergetree-aggregation/)
7. [ClickHouse Series: Real-Time Aggregation Queries with Materialized Views](https://blog.vicwen.app/posts/clickhouse-materialized-view/)
8. [ClickHouse Series: Partition Strategy and Partition Pruning Explained](https://blog.vicwen.app/posts/clickhouse-partition-pruning/)
9. [ClickHouse Series: How Primary Key, Sorting Key, and Granule Indexes Work](https://blog.vicwen.app/posts/clickhouse-primary-sorting-key/)
10. [ClickHouse Series: Best Practices for CollapsingMergeTree and Soft Deletes](https://blog.vicwen.app/posts/clickhouse-collapsingmergetree/)
11. [ClickHouse Series: VersionedCollapsingMergeTree for Version Control and Conflict Resolution](https://blog.vicwen.app/posts/clickhouse-versioned-collapsingmergetree/)
12. [ClickHouse Series: Advanced Real-Time Metrics with AggregatingMergeTree](https://blog.vicwen.app/posts/clickhouse-aggregatingmergetree/)
13. [ClickHouse Series: Distributed Tables and Distributed Query Architecture](https://blog.vicwen.app/posts/clickhouse-distributed-table-architecture/)
14. [ClickHouse Series: Replicated Tables for High Availability and Zero-Downtime Upgrades](https://blog.vicwen.app/posts/clickhouse-replication-failover/)
15. [ClickHouse Series: Building a Real-Time Data Streaming Pipeline with Kafka](https://blog.vicwen.app/posts/clickhouse-kafka-data-streaming-pipeline/)
16. [ClickHouse Series: Best Practices for Batch Import (CSV, Parquet, Native Format)](https://blog.vicwen.app/posts/clickhouse-batch-import/)
17. [ClickHouse Series: Integrating ClickHouse with External Data Sources (PostgreSQL)](https://blog.vicwen.app/posts/clickhouse-external-data-integration/)
18. [ClickHouse Series: How to Improve Query Optimization? Using `system.query_log` and `EXPLAIN`](https://blog.vicwen.app/posts/clickhouse-query-log-explain/)
19. [ClickHouse Series: Advanced Query Acceleration with Projections](https://blog.vicwen.app/posts/clickhouse-projections-optimization/)
20. [ClickHouse Series: Sampling Queries and the Principles Behind Statistical Techniques](https://blog.vicwen.app/posts/clickhouse-sampling-statistics/)
21. [ClickHouse Series: TTL Data Cleanup and Storage Cost Optimization](https://blog.vicwen.app/posts/clickhouse-ttl-storage-management/)
22. [ClickHouse Series: Storage Policies and Disk Tiering Strategy](https://blog.vicwen.app/posts/clickhouse-storage-policies/)
23. [ClickHouse Series: Table Design and Storage Optimization Details](https://blog.vicwen.app/posts/clickhouse-schemas-storage-improvement/)
24. [ClickHouse Series: Building Visual Monitoring with Grafana](https://blog.vicwen.app/posts/clickhouse-grafana-dashboard/)
25. [ClickHouse Series: Query Optimization Case Studies](https://blog.vicwen.app/posts/clickhouse-select-optimization/)
26. [ClickHouse Series: Integrating with BI Tools (Power BI)](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
27. [ClickHouse Series: ClickHouse Cloud vs. Self-Hosted Deployment](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
28. [ClickHouse Series: Database Security and RBAC Implementation](https://blog.vicwen.app/posts/clickhouse-security-rbac/)
29. [ClickHouse Series: Deploying Distributed Architecture on Kubernetes](https://blog.vicwen.app/posts/clickhouse-operator-kubernates/)
30. [ClickHouse Series: Six Core MergeTree Mechanisms Through the Source Code](https://blog.vicwen.app/posts/clickhouse-mergetree-sourcecode-introduction/)
