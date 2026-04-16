---
title: "ClickHouse Series: Why Does ClickHouse Choose Column-based Storage? The Core Differences Between Row-based and Column-based Storage"
published: 2025-08-05
description: ""
image: "https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress"
tags: [ClickHouse, Database, Ironman]
category: "software development"
draft: false
lang: "en"
---

In the previous two articles, I mentioned that Row-based Storage and Column-based Storage are the fundamental architectural differences between OLTP and OLAP systems. This article starts from the storage principles themselves to explain why ClickHouse chose a columnar architecture, and what performance benefits and use cases that choice brings.

## What is Row-based Storage?

Row-based storage keeps all fields of a record together on disk, organized by row. In other words, when the database accesses data, it reads every field of that row at once.

### Advantages:

* **Well suited for OLTP workloads**: for example, order processing in an e-commerce system or a member login system.
* **Efficient for single-row queries and updates**: when querying or updating a single record by primary key, the full row can be retrieved quickly.

### Disadvantages:

* **Poor batch query efficiency**: when we only need a specific column across a large amount of data, such as for reporting, row storage still reads the entire row, wasting I/O.
* **Weak compression efficiency**: because field types and value distributions vary within a row, compression results are limited.

### Representative databases:

MySQL, PostgreSQL, Oracle DB, SQL Server

## What is Column-based Storage?

Column-based storage keeps data on disk by column. Each column's data is stored independently and contiguously, so a query only needs to read the columns it actually requires.

### Advantages:

* **Excellent query performance in OLAP workloads**: for example, when only the age distribution of users is needed, the system reads only the Age column and does not touch irrelevant columns such as Name or Address.
* **High compression ratio**: values in the same column share the same type and often repeat, making encoding and compression much more effective (for example, Run-Length Encoding and Delta Encoding).
* **Vectorized execution speeds up queries**: because column data is stored densely, the CPU can process it in SIMD batches and execute queries faster.

### Disadvantages:

* **Less efficient for single-row lookups**: if the goal is to fetch a complete record, data must be read from multiple column locations and stitched together, which adds latency.
* **Not ideal for write-heavy workloads**: writes and updates are more expensive, so it is better suited to read-heavy scenarios.

### Representative databases:

ClickHouse, Apache Druid, Amazon Redshift, Google BigQuery

## Why Did ClickHouse Choose Column-based Storage?

As a database optimized for OLAP, ClickHouse chose a columnar architecture to remove the performance bottlenecks that appear when querying data at scale. Here are some of the key advantages brought by columnar storage:

### 1. Read only the columns you need

In a traditional row-based database, querying a single column across millions of rows still loads the other columns in the same row, wasting a lot of I/O. ClickHouse reads only the columns required by the query from disk, which dramatically reduces I/O and lowers latency.

### 2. Extremely strong compression

ClickHouse includes multiple compression codecs (LZ4, ZSTD, Gorilla Encoding) and takes advantage of the redundancy in columnar data to shrink storage usage by several times, sometimes even dozens of times. That saves storage cost and also reduces I/O transfer volume, which further improves query performance.

### 3. Vectorized query execution

ClickHouse centers on vectorized execution, converting column data into contiguous memory blocks for SIMD batch processing. This pushes CPU utilization and execution speed for aggregation queries such as SUM, AVG, and COUNT to a very high level.

### 4. A perfect match with Data Skipping Indexes

ClickHouse uses Data Skipping Indexes. When query conditions do not match certain data blocks, those blocks can be skipped entirely. This works especially well with a columnar architecture, avoiding full table scans and allowing large-scale queries to return in seconds or even milliseconds.

### 5. Better aligned with data analysis needs

In modern analytics workloads, most queries involve heavy reads and multi-column aggregation, while writes and updates are relatively rare. By adopting columnar storage, ClickHouse focuses on the "read-heavy, write-light" pattern and fits reporting, user behavior analysis, and real-time dashboard use cases very well.

## Summary of Row-based vs. Column-based Use Cases

| Type | Row-based databases | Column-based databases |
| ------ | ----------------------- | ------------------------- |
| Typical use case | OLTP systems (order processing, member login) | OLAP systems (analytics, reporting, metric monitoring) |
| Query pattern | Single-record lookups (primary key queries, frequent writes) | Batch queries (aggregation and large-scale column reads) |
| Write frequency | Frequent writes and updates | Low write frequency, mostly batch or streaming ingestion |
| Query efficiency | Fast single-row reads, weak batch performance | Slower single-row reads, extremely fast batch performance |
| Representative databases | MySQL, PostgreSQL, Oracle | ClickHouse, Druid, Redshift |

## Closing thoughts

Most everyday development work tends to use OLTP databases because the focus is usually on real-time transaction processing (ACID). I only got exposed to TB- and PB-scale data by chance, and that is when I realized there is a whole world of OLAP, OLTP, Row-based Storage, and Column-based Storage behind it.

### ClickHouse Series Updates:

1. [ClickHouse Series: What Is ClickHouse? How It Differs from Traditional OLAP/OLTP Databases](https://blog.vicwen.app/posts/what-is-clickhouse/)
2. [ClickHouse Series: Why Does ClickHouse Choose Column-based Storage? The Core Differences Between Row-based and Column-based Storage](https://blog.vicwen.app/posts/clickhouse-column-row-based-storage/)
3. [ClickHouse Series: ClickHouse Storage Engine - MergeTree](https://blog.vicwen.app/posts/clickhouse-mergetree-engine)
4. [ClickHouse Series: How Compression and Data Skipping Indexes Greatly Speed Up Queries](https://blog.vicwen.app/posts/clickhouse-compression-skipping-index/)
5. [ClickHouse Series: ReplacingMergeTree and Data Deduplication](https://blog.vicwen.app/posts/clickhouse-replacingmergetree-deduplication/)
6. [ClickHouse Series: SummingMergeTree for Data Aggregation Use Cases](https://blog.vicwen.app/posts/clickhouse-summingmergetree-aggregation/)
7. [ClickHouse Series: Materialized Views for Real-Time Aggregation Queries](https://blog.vicwen.app/posts/clickhouse-materialized-view/)
8. [ClickHouse Series: Partitioning Strategy and Partition Pruning Explained](https://blog.vicwen.app/posts/clickhouse-partition-pruning/)
9. [ClickHouse Series: How Primary Keys, Sorting Keys, and Granule Indexes Work](https://blog.vicwen.app/posts/clickhouse-primary-sorting-key/)
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
