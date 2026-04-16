---
title: "ClickHouse Series: How Compression and Data Skipping Indexes Greatly Speed Up Queries"
published: 2025-08-07
description: ""
image: "https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress"
tags: [ClickHouse, Database, Ironman]
category: "software development"
draft: false
lang: "en"
---

Behind ClickHouse's high-performance queries, in addition to columnar storage and vectorized execution, **compression** and **Data Skipping Indexes** are also core reasons why it can handle PB-scale data. This article explains the principles and use cases behind both techniques, and shows how they improve query efficiency and reduce storage costs.

> [One of the secrets to ClickHouse query performance is compression.](https://clickhouse.com/docs/data-compression/compression-in-clickhouse)

## Why is compression so important for OLAP performance?

In OLAP workloads, the data volume can easily reach millions or tens of millions of rows. Without good compression, disk I/O quickly becomes the bottleneck. ClickHouse uses Columnar Storage, which makes each column consistent in type and highly repetitive, so compression works extremely well.

### ClickHouse compression benefits:
* **Lower storage usage** (compression ratios are often 5 to 10 times or more)
* **Less disk I/O transfer** (faster reads, lower latency)
* **Better CPU decompression performance** (using lightweight, fast compression algorithms)

## Compression codecs supported by ClickHouse

| Compression codec | Characteristics and use cases |
| -------------------- | ------------------------------------------ |
| **LZ4 (default)** | Fast and low-latency, moderate compression ratio, default codec, suitable for real-time queries and writes |
| **ZSTD** | Better compression ratio than LZ4, but slightly slower compression and decompression; good for cold storage or report analysis |
| **Delta Encoding** | Compresses increasing numeric values such as timestamps and IDs by storing differences, greatly reducing storage usage |
| **Gorilla Encoding** | Highly optimized for time-series data, suitable for IoT and telemetry compression such as CPU usage or temperature |
| **Double Delta** | Useful for numeric data with smooth trends, improving compression further |

Below is the compression statistics for a ClickHouse table storing StackOverflow posts. The query uses `system.columns` to retrieve the compressed and uncompressed size of each column, as well as the compression ratio.

```sql
SELECT name,
   formatReadableSize(sum(data_compressed_bytes)) AS compressed_size,
   formatReadableSize(sum(data_uncompressed_bytes)) AS uncompressed_size,
   round(sum(data_uncompressed_bytes) / sum(data_compressed_bytes), 2) AS ratio
FROM system.columns
WHERE table = 'posts'
GROUP BY name

┌─name──────────────────┬─compressed_size─┬─uncompressed_size─┬───ratio────┐
│ Body                  │ 46.14 GiB       │ 127.31 GiB        │ 2.76       │
│ Title                 │ 1.20 GiB        │ 2.63 GiB          │ 2.19       │
│ Score                 │ 84.77 MiB       │ 736.45 MiB        │ 8.69       │
│ Tags                  │ 475.56 MiB      │ 1.40 GiB          │ 3.02       │
│ ParentId              │ 210.91 MiB      │ 696.20 MiB        │ 3.3        │
│ Id                    │ 111.17 MiB      │ 736.45 MiB        │ 6.62       │
│ AcceptedAnswerId      │ 81.55 MiB       │ 736.45 MiB        │ 9.03       │
│ ClosedDate            │ 13.99 MiB       │ 517.82 MiB        │ 37.02      │
│ LastActivityDate      │ 489.84 MiB      │ 964.64 MiB        │ 1.97       │
│ CommentCount          │ 37.62 MiB       │ 565.30 MiB        │ 15.03      │
│ OwnerUserId           │ 368.98 MiB      │ 736.45 MiB        │ 2          │
│ AnswerCount           │ 21.82 MiB       │ 622.35 MiB        │ 28.53      │
│ FavoriteCount         │ 280.95 KiB      │ 508.40 MiB        │ 1853.02    │
│ ViewCount             │ 95.77 MiB       │ 736.45 MiB        │ 7.69       │
│ LastEditorUserId      │ 179.47 MiB      │ 736.45 MiB        │ 4.1        │
│ ContentLicense        │ 5.45 MiB        │ 847.92 MiB        │ 155.5      │
│ OwnerDisplayName      │ 14.30 MiB       │ 142.58 MiB        │ 9.97       │
│ PostTypeId            │ 20.93 MiB       │ 565.30 MiB        │ 27         │
│ CreationDate          │ 314.17 MiB      │ 964.64 MiB        │ 3.07       │
│ LastEditDate          │ 346.32 MiB      │ 964.64 MiB        │ 2.79       │
│ LastEditorDisplayName │ 5.46 MiB        │ 124.25 MiB        │ 22.75      │
│ CommunityOwnedDate    │ 2.21 MiB        │ 509.60 MiB        │ 230.94     │
└───────────────────────┴─────────────────┴───────────────────┴────────────┘
```

You can see that:
* Highly repetitive columns such as `FavoriteCount` and `ContentLicense` can reach compression ratios of hundreds or even thousands of times. That is the advantage of columnar storage combined with specialized codecs.
* Numeric columns such as `Score`, `AcceptedAnswerId`, and `PostTypeId` also compress very well. Delta encoding combined with LZ4 or ZSTD can greatly reduce data size.
* Although `Body` and `Title` are text columns, they still achieve a 2-3x compression ratio, and combining them with LowCardinality will improve space efficiency even more.

## How do you specify a compression algorithm?

You can specify codecs for individual columns when creating a table using the `CODEC` parameter:

```sql
CREATE TABLE user_events (
  event_date Date,
  user_id UInt32,
  event_type String CODEC(ZSTD),
  event_value Float64 CODEC(Delta, LZ4)
) ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, user_id);
```

### Explanation:

* `event_type` uses ZSTD, which is good for highly repetitive string columns.
* `event_value` uses Delta encoding for numeric values and then LZ4 for compression, improving both query speed and storage efficiency.

---

## How Data Skipping Indexes work in ClickHouse

**Data Skipping Indexes** are a ClickHouse-specific query acceleration technique. The core idea is:

> **At query time, scan only the necessary data blocks, skip irrelevant blocks, and reduce I/O cost and latency.**

These are not traditional B-Tree indexes. Instead, they are a fast filtering mechanism built on column statistics inside MergeTree data parts.

## How does minmax indexing work?

Each MergeTree part automatically creates a `minmax` index for the primary key columns, for example:

```sql
SELECT * FROM orders WHERE order_date >= '2025-01-01' AND order_date < '2025-02-01';
```

* The system checks the `min(order_date)` and `max(order_date)` range of each data block.
* If a block's date range cannot possibly match the query conditions, it is skipped completely.

Suppose you have one billion log rows:

* With the default minmax index, a query for one day of data can skip 99% of the blocks.
* Query latency can drop from 15 seconds to 300 milliseconds.
* The system only reads and decompresses 1% of the data, which saves a huge amount of CPU and I/O.

That is the effect of **Partition Pruning + Data Skipping**.

## Advanced: secondary index implementation

ClickHouse also lets you build more advanced indexes on specific columns, for example:

```sql
CREATE TABLE logs (
  timestamp DateTime,
  level String,
  message String
) ENGINE = MergeTree
ORDER BY timestamp
SETTINGS index_granularity = 8192;

ALTER TABLE logs ADD INDEX idx_level (level) TYPE set(1000) GRANULARITY 1;
```

### Index type reference:

| Index type | Description and use case |
| -------------- | ------------------------------- |
| `minmax` | Default; speeds up range queries on numeric or date values |
| `set(N)` | Set-based index, good for highly repetitive string columns such as log levels |
| `ngrambf_v1` | Suitable for fuzzy queries and uses a bloom filter for fast matching |
| `bloom_filter` | Quickly filters possible values, good for multi-value columns such as tags or labels |


## Best practices and notes

* **Index granularity**: the default `index_granularity` is 8192 rows. If queries are frequent, the granularity can be reduced a bit to improve skipping efficiency.
* **Use compression and indexes together**: compression reduces data size, and indexes reduce the scanned range. Together they deliver excellent query performance.
* **Do not overuse indexes**: too many indexes increase write overhead, so create them only for frequently queried columns.

## Closing thoughts

With efficient compression and skipping indexes, ClickHouse can make big-data queries respond in milliseconds. Just do not overuse indexes, or the result may be the opposite of what you want.

### ClickHouse Series Updates:

1. [ClickHouse Series: What Is ClickHouse? How It Differs from Traditional OLAP/OLTP Databases](https://blog.vicwen.app/posts/what-is-clickhouse/)
2. [ClickHouse Series: Why Does ClickHouse Choose Column-based Storage? The Core Differences Between Row-based and Column-based Storage](https://blog.vicwen.app/posts/clickhouse-column-row-based-storage/)
3. [ClickHouse Series: ClickHouse Storage Engine - MergeTree](https://blog.vicwen.app/posts/clickhouse-mergetree-engine)
4. [ClickHouse Series: How Compression and Data Skipping Indexes Greatly Speed Up Queries](https://blog.vicwen.app/posts/clickhouse-compression-skipping-index/)
5. [ClickHouse Series: ReplacingMergeTree and Data Deduplication](https://blog.vicwen.app/posts/clickhouse-replacingmergetree-deduplication/)
6. [ClickHouse Series: SummingMergeTree for Data Aggregation Use Cases](https://blog.vicwen.app/posts/clickhouse-summingmergetree-aggregation/)
7. [ClickHouse Series: Materialized Views for Real-Time Aggregation Queries](https://blog.vicwen.app/posts/clickhouse-materialized-view/)
8. [ClickHouse Series: Partitioning Strategy and Partition Pruning Explained](https://blog.vicwen.app/posts/clickhouse-partition-pruning/)
9. [ClickHouse Series: How Primary Key, Sorting Key, and Granule Indexes Work](https://blog.vicwen.app/posts/clickhouse-primary-sorting-key/)
10. [ClickHouse Series: CollapsingMergeTree and Best Practices for Logical Deletion](https://blog.vicwen.app/posts/clickhouse-collapsingmergetree/)
11. [ClickHouse Series: VersionedCollapsingMergeTree for Version Control and Conflict Resolution](https://blog.vicwen.app/posts/clickhouse-versioned-collapsingmergetree/)
12. [ClickHouse Series: Advanced Uses of AggregatingMergeTree for Real-Time Metrics](https://blog.vicwen.app/posts/clickhouse-aggregatingmergetree/)
13. [ClickHouse Series: Distributed Tables and Distributed Query Architecture](https://blog.vicwen.app/posts/clickhouse-distributed-table-architecture/)
14. [ClickHouse Series: High Availability and Zero-Downtime Upgrades with Replicated Tables](https://blog.vicwen.app/posts/clickhouse-replication-failover/)
15. [ClickHouse Series: Building a Real-Time Data Streaming Pipeline with Kafka Integration](https://blog.vicwen.app/posts/clickhouse-kafka-data-streaming-pipeline/)
16. [ClickHouse Series: Best Practices for Batch Imports (CSV, Parquet, Native Format)](https://blog.vicwen.app/posts/clickhouse-batch-import/)
17. [ClickHouse Series: Integrating ClickHouse with External Data Sources (PostgreSQL)](https://blog.vicwen.app/posts/clickhouse-external-data-integration/)
18. [ClickHouse Series: How to Improve Query Performance with system.query_log and EXPLAIN](https://blog.vicwen.app/posts/clickhouse-query-log-explain/)
19. [ClickHouse Series: Advanced Query Acceleration with Projections](https://blog.vicwen.app/posts/clickhouse-projections-optimization/)
20. [ClickHouse Series: Sampling Queries and Statistical Techniques](https://blog.vicwen.app/posts/clickhouse-sampling-statistics/)
21. [ClickHouse Series: TTL Data Cleanup and Storage Cost Optimization](https://blog.vicwen.app/posts/clickhouse-ttl-storage-management/)
22. [ClickHouse Series: Storage Policies and Tiered Disk Strategy](https://blog.vicwen.app/posts/clickhouse-storage-policies/)
23. [ClickHouse Series: Table Design and Storage Optimization Details](https://blog.vicwen.app/posts/clickhouse-schemas-storage-improvement/)
24. [ClickHouse Series: Building Visual Monitoring with Grafana Integration](https://blog.vicwen.app/posts/clickhouse-grafana-dashboard/)
25. [ClickHouse Series: Query Optimization Case Studies](https://blog.vicwen.app/posts/clickhouse-select-optimization/)
26. [ClickHouse Series: Integrating with BI Tools (Power BI)](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
27. [ClickHouse Series: Comparing ClickHouse Cloud and Self-Hosted Deployments](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
28. [ClickHouse Series: Implementing Database Security and RBAC](https://blog.vicwen.app/posts/clickhouse-security-rbac/)
29. [ClickHouse Series: Deploying a Distributed Architecture on Kubernetes](https://blog.vicwen.app/posts/clickhouse-operator-kubernates/)
30. [ClickHouse Series: The Six Core Mechanisms of MergeTree from the Source Code](https://blog.vicwen.app/posts/clickhouse-mergetree-sourcecode-introduction/)
