---
title: "ClickHouse Series: What Is ClickHouse? How It Differs from Traditional OLAP/OLTP Databases"
published: 2025-08-04
description: ""
image: "https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress"
tags: [ClickHouse, Database, Ironman]
category: "software development"
draft: false
lang: "en"
---

ClickHouse is an open-source distributed column-oriented DBMS developed by Yandex.

It is designed mainly for **real-time analytics** and can process **PB-scale** data within seconds.

::github{repo=ClickHouse/ClickHouse}

## Architecture

![ClickHouse Architecture](https://clickhouse.com/docs/assets/ideal-img/_vldb2024_2_Figure_0.ab9606a.1024.png)

The overall design of ClickHouse is very clear: its core goal is high-performance reads, and through distributed architecture plus storage optimizations, it makes second-level queries possible even on PB-scale data.
From data ingestion, storage, and indexing to query results, ClickHouse uses a storage engine architecture optimized specifically for OLAP workloads.

You can simplify the pipeline like this:

```text
Data write -> Data Parts -> Partitioning -> Primary Key sorting -> Compression -> Merge -> Index pruning -> Vectorized query execution -> Result
```

Confused? No worries. By the end of this series, it will all make sense 😎

> Image from [Architecture Overview](https://clickhouse.com/docs/academic_overview)

## Features & Characteristics

| ClickHouse Feature | Description |
| ------------------ | ----------- |
| Columnar Storage | Reads only the columns you need, avoiding unnecessary I/O. |
| Vectorized Execution | Converts data into SIMD-friendly batches to speed up CPU processing. |
| Compression | Compression schemes such as LZ4, ZSTD, and Delta Encoding provide high compression ratios and lower storage costs. |
| Data Skipping Indexes | Instead of scanning everything, ClickHouse can skip irrelevant data blocks directly using indexes, making queries faster. |
| MergeTree storage engine | A powerful and flexible storage layer that supports partitions, sorting keys, TTL cleanup, and is well suited to large-scale analytics. |
| Materialized Views | Precompute complex query results and update them in real time to dramatically speed up queries. |
| Distributed architecture | Supports sharding and replicas, making it easy to scale to PB-level workloads. |
| Near-real-time ingestion | Supports high-throughput ingestion such as Kafka streams, enabling second-level queryability. |


## OLAP vs. OLTP Basics

| Category | OLTP (Online Transaction Processing) | OLAP (Online Analytical Processing) |
| ---- | ------------------------------------ | ----------------------------------- |
| Main purpose | Transaction processing (CRUD operations) | Data analysis and reporting |
| Workload pattern | Frequent writes of small amounts of data | Batch queries over large amounts of data |
| Query style | Single-row or small-set lookups | Large-range aggregation queries |
| Storage model | Row-based | Column-based |
| Representative products | MySQL, PostgreSQL, Oracle | ClickHouse, Druid, Redshift |

## Differences Between ClickHouse and Traditional OLAP Databases

| Item | ClickHouse | Traditional Data Warehouse (e.g. Oracle DW, Teradata) |
| ---- | ---------- | ------------------------------------------------------ |
| Architecture | Distributed columnar storage | Mostly row-based storage or requires extra columnar configuration |
| Query speed | Millisecond to second-level responses | Usually several seconds to minutes |
| Hardware needs | Works on commodity hardware | Often requires expensive specialized servers |
| Cost | Open-source and free / cloud usage pricing | High software and hardware cost |
| Scalability | Linear horizontal scaling through sharding and replication | Expensive to scale |


## Differences Between ClickHouse and OLTP Databases (e.g. MySQL, PostgreSQL)

1. OLTP databases focus on ACID transaction integrity and real-time processing with frequent writes.
2. ClickHouse is better suited for **heavy read queries** with **infrequent real-time updates** (for example, reporting queries and BI analytics).
3. Common OLTP UPDATE/DELETE operations are non-real-time in ClickHouse and are handled through the Mutation mechanism.

### ClickHouse Series, still growing:

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
18. [ClickHouse Series: How to Improve Query Optimization? system.query_log and EXPLAIN](https://blog.vicwen.app/posts/clickhouse-query-log-explain/)
19. [ClickHouse Series: Advanced Query Acceleration with Projections](https://blog.vicwen.app/posts/clickhouse-projections-optimization/)
20. [ClickHouse Series: Sampling Queries and Statistical Techniques](https://blog.vicwen.app/posts/clickhouse-sampling-statistics/)
21. [ClickHouse Series: TTL Data Cleanup and Storage Cost Optimization](https://blog.vicwen.app/posts/clickhouse-ttl-storage-management/)
22. [ClickHouse Series: Storage Policies and Tiered Disk Strategy](https://blog.vicwen.app/posts/clickhouse-storage-policies/)
23. [ClickHouse Series: Table Design and Storage Optimization Details](https://blog.vicwen.app/posts/clickhouse-schemas-storage-improvement/)
24. [ClickHouse Series: Building Visual Monitoring with Grafana Integration](https://blog.vicwen.app/posts/clickhouse-grafana-dashboard/)
25. [ClickHouse Series: Query Optimization Case Studies](https://blog.vicwen.app/posts/clickhouse-select-optimization/)
26. [ClickHouse Series: Integrating with BI Tools (Power BI)](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
27. [ClickHouse Series: ClickHouse Cloud vs. Self-Hosted Deployment](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
28. [ClickHouse Series: Implementing Database Security and RBAC](https://blog.vicwen.app/posts/clickhouse-security-rbac/)
29. [ClickHouse Series: Deploying Distributed Architecture on Kubernetes](https://blog.vicwen.app/posts/clickhouse-operator-kubernates/)
30. [ClickHouse Series: The Six Core Mechanisms of MergeTree from the Source Code](https://blog.vicwen.app/posts/clickhouse-mergetree-sourcecode-introduction/)
