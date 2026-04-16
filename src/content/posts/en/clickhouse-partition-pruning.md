---
title: "ClickHouse Series: Partitioning Strategy and Partition Pruning, How to Speed Up Big Data Queries"
published: 2025-08-11
description: ""
image: "https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress"
tags: [ClickHouse, Database, Ironman]
category: "software development"
draft: false
lang: "en"
---

When you are dealing with hundreds of millions or even billions of rows, query performance will collapse if every query has to scan the whole table. ClickHouse provides flexible **Partitioning** and **Partition Pruning** so that queries only scan the data blocks that are truly relevant, drastically reducing I/O and latency.

## What is a Partition?

In ClickHouse, a **partition is a logical unit of data splitting**. Data is split into independent blocks (directories) based on a specified Partition Key expression, and those blocks can be filtered during query time to avoid full table scans.

### Important characteristics:

* Partitioning is one of the core structures of the MergeTree engine.
* The Partition Key can be any expression, such as `toYYYYMM(date)`, `device_id`, or `region_id`.
* Partitioning happens at the "physical directory" level, which makes the optimization effect very obvious.
* The smaller the partitioning scope, the more data queries can skip, but the more small files and merge overhead you create.

## Difference between Partition and Primary Key

| Comparison item | Partition | Primary Key |
| ---- | ------------------------------ | ------------------------------ |
| Scope | Splits data directories at the disk level | Sorted index inside blocks at the storage-engine level |
| Query pruning | If the query matches the Partition Key, the block can be skipped directly | If the query matches the Primary Key, the data block can be located precisely |
| Design basis | Common range conditions, such as date or business region | Fine-grained query conditions, such as `user_id` or `order_id` |

The two are complementary: Partition is used for coarse range pruning, while Primary Key is used for precise positioning.

## How Partition Pruning works

Partition Pruning is ClickHouse automatically determining, based on the WHERE clause, which partitions cannot possibly contain matching data and skipping them entirely.

### Example:

```sql
CREATE TABLE page_views
(
    event_date Date,
    user_id UInt64,
    page String
) ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, user_id);
```

### Query:

```sql
SELECT count() FROM page_views
WHERE event_date >= '2025-08-01' AND event_date < '2025-08-02';
```

* ClickHouse uses the `toYYYYMM(event_date)` Partition Key to determine that only the 202508 partition could match. All other partitions are skipped and are not scanned.

## Partition Key design strategy

| Design strategy | Suitable scenario |
| --------------------------------------- | -------------------------------------------------------- |
| **Split by time dimension (`toYYYYMM`, `toYYYYMMDD`)** | Time-series data, log systems, and traffic monitoring (choose granularity based on query frequency) |
| **Split by business dimension (`region_id`, `device_type`)** | Scenarios where different regions or device types are queried independently, suitable for sharding and query load balancing |
| **Composite partitions (for example, `toYYYYMM(date)`, `region_id`)** | Time + region workloads, but be careful not to create too many partitions |
| **Avoid high-cardinality fields for partitioning** | Columns such as `user_id` or UUID are not good Partition Keys, or you will create too many small files |

## Balancing granularity and efficiency

| Granularity | Advantages | Disadvantages |
| -------------- | ------------------------ | --------------------------------------- |
| toYYYYMM | Moderate partition count, suitable for querying data over several months | Cross-month queries are only average in efficiency, and merges happen more often after writes |
| toYYYYMMDD | Can improve pruning to day-level granularity, good for logs and real-time querying | Produces many small parts and increases disk IOPS plus background merge overhead |
| Composite partitioning (time + dimension) | Finest granularity and excellent pruning | Be careful of partition explosion (it is recommended to keep the Partition Key under 10,000 values) |

## How can you verify that Partition Pruning is working?

1. **Use `EXPLAIN`**:

```sql
EXPLAIN PLAN SELECT * FROM page_views WHERE event_date = '2025-08-01';
```

2. **Check partition read stats (`system.parts`)**:

```sql
SELECT
    partition,
    active,
    rows,
    bytes_on_disk
FROM system.parts
WHERE table = 'page_views' AND active;
```

3. **Inspect query profile events**:

```sql
SET send_logs_level = 'trace';
SELECT count() FROM page_views WHERE event_date = '2025-08-01';
```

In the query profile events, you can check whether `read_rows` and `read_bytes` have dropped significantly.

## Real-world example

Suppose a website stores 3 billion click records per month. Without partitioning, querying a single day would require a full table scan and could take tens of seconds due to I/O latency. If you set the Partition Key to `toYYYYMMDD(event_date)`:

* A single-day query only scans 1/30 of the data.
* Query latency can drop from 30 seconds to under 1 second.
* Combining this with a Primary Key such as `page` and `user_id` lets you filter even more precisely.

## Relationship between Partition and Sharding

| Partition | Sharding |
| --------------------------- | ------------------------------ |
| Splits data inside one table into multiple blocks so the query range can be pruned | Horizontally splits the entire table across different nodes in the cluster to improve distributed computing capacity |
| Affects only the scan range of single-table queries | Affects where the data lives and the distributed query execution path |
| Pruning relies on WHERE conditions and reduces scanned data | Pruning relies on the shard key and distributed routing rules to decide which nodes must participate |

They can be combined, for example:

* Shard key = `user_id` (balanced writes across shards)
* Partition key = `toYYYYMM(date)` (faster range queries)

## Best practices and notes

| Best practice | Description |
| ----------------------- | ------------------------------------------ |
| Design the Partition Key based on query patterns | Use the most common WHERE range conditions, such as date or region, as the pruning dimension |
| Be careful about partition explosion | Avoid high-cardinality columns as partition keys; aim to keep the number of partitions within a few thousand to ten thousand |
| Monitor partition health with `system.parts` | Regularly check Active Parts counts and sizes to avoid too many small files hurting merge performance |
| Combine with Primary Key for precise positioning | Partition handles coarse pruning, Primary Key handles fine pruning, and together they give the best query performance |
| Do not change the Partition Key frequently | Changing it is effectively the same as rebuilding the table, so design it carefully upfront |

## Closing thoughts

Partition Pruning is one of ClickHouse's most powerful query acceleration techniques when working with large datasets. With a sensible partitioning strategy, you can reduce I/O pressure and still keep OLAP reports and real-time queries in the millisecond range even at TB scale.


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
