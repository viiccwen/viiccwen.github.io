---
title: "ClickHouse Series: Best Practices for Batch Imports (CSV, Parquet, Native Format)"
published: 2025-08-19
description: ""
image: "https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress"
tags: [ClickHouse, Database, Ironman, Distributed]
category: "software development"
draft: false
lang: "en"
---

In real-world analytics and data warehouse scenarios, batch import is one of the most common ways to load data into ClickHouse.
Depending on the data volume, source, and format, choosing the right import method and file format can greatly improve import speed and reduce resource usage.

This article introduces three common formats:

* **CSV (general-purpose text format)**
* **Parquet (columnar compressed format)**
* **ClickHouse Native Format (native binary format)**

## Basic Import Flow

In ClickHouse, batch imports are most commonly performed through:

1. **clickhouse-client** command-line import (I've only used this for debugging...)
2. **HTTP interface** (`INSERT INTO ... FORMAT`)
3. **External tools** such as `clickhouse-local`, ETL tools, and Python SDKs

No matter which method you use, you must:

* Create the target table first (the schema must match the file structure)
* Use a suitable table engine (the MergeTree family is the most common)

## Importing CSV

### Suitable scenarios

* The source system exports plain text files
* Cross-platform, easy to inspect and edit
* **Not focused on maximum performance**, but easy to integrate

### Example

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

### Performance tips

* Add `--max_insert_block_size=1000000` to increase batch write size
* For large files, you can compress them with `gzip`:

  ```bash
  zcat events.csv.gz | clickhouse-client --query="INSERT INTO events_csv FORMAT CSV"
  ```

## Importing Parquet

### Suitable scenarios

* Upstream systems such as Spark, Flink, or Hive already output columnar format
* Large batch datasets at the GB-to-TB scale
* You want to preserve type information and compression efficiency

### Example

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

### Performance tips

* Parquet is already compressed, so import CPU usage is higher but I/O cost is lower
* Avoid importing too many small files; merge them first if possible
* If the file is in the cloud (S3), you can load it directly with the `s3()` function:

  ```sql
  INSERT INTO events_parquet
  SELECT * FROM s3('https://bucket/file.parquet', 'AWS_KEY', 'AWS_SECRET', 'Parquet');
  ```

## Importing ClickHouse Native Format

### Suitable scenarios

* High-speed transfer between ClickHouse instances
* Maximum performance, with no format parsing required
* Suitable for backups and restores

### Example

```bash
clickhouse-client --query="SELECT * FROM events_csv FORMAT Native" > events.native
clickhouse-client --query="INSERT INTO events_native FORMAT Native" < events.native
```

### Performance tips

* Faster than CSV/Parquet, good for machine-to-machine data migration
* Not suitable for multi-source systems (ClickHouse only)
* Can be combined with `clickhouse-backup` for full-cluster migration

## Performance Optimization Strategies

| Strategy       | Description                                           |
| -------------- | ----------------------------------------------------- |
| **Large one-shot imports** | Avoid many small INSERTs and reduce write pressure |
| **Align with the sorting key** | If the import order matches `ORDER BY`, Merge overhead is lower |
| **Disable index checks** | Before batch imports, you can temporarily disable some checks such as `constraints` |
| **Partitioned batch imports** | Split files by date or business key and import them in parallel |

## Comparison of Import Methods

| Format     | Pros                   | Cons                    | Suitable scenarios         |
| ---------- | ---------------------- | ----------------------- | -------------------------- |
| **CSV**    | General-purpose, easy to read, easy to generate | Large size, slow parsing | System-to-system exchange, small imports |
| **Parquet** | High compression, columnar storage | Parsing is more CPU-intensive | Large batch imports |
| **Native** | Fastest import, no parsing | Only available for ClickHouse | Backups, restores, cluster migration |

## Summary

* **Small amounts of data** -> CSV, convenient for integration and inspection
* **Large batch imports** -> Parquet, reduces I/O and storage space
* **ClickHouse internal transfers** -> Native, highest performance

If batch imports are frequent, you can combine **partitioning** and **parallel batch imports** to shorten load time even further.

### ClickHouse Series Continues:

1. [ClickHouse Series: What Is ClickHouse? How It Differs from Traditional OLAP/OLTP Databases](https://blog.vicwen.app/posts/what-is-clickhouse/)
2. [ClickHouse Series: Why ClickHouse Uses Column-Based Storage? Core Differences Between Row-Based and Column-Based Storage](https://blog.vicwen.app/posts/clickhouse-column-row-based-storage/)
3. [ClickHouse Series: ClickHouse Storage Engine - MergeTree](https://blog.vicwen.app/posts/clickhouse-mergetree-engine)
4. [ClickHouse Series: How Compression and Data Skipping Indexes Dramatically Speed Up Queries](https://blog.vicwen.app/posts/clickhouse-compression-skipping-index/)
5. [ClickHouse Series: ReplacingMergeTree and Data Deduplication](https://blog.vicwen.app/posts/clickhouse-replacingmergetree-deduplication/)
6. [ClickHouse Series: Practical Uses of SummingMergeTree for Aggregation](https://blog.vicwen.app/posts/clickhouse-summingmergetree-aggregation/)
7. [ClickHouse Series: Real-Time Aggregation with Materialized Views](https://blog.vicwen.app/posts/clickhouse-materialized-view/)
8. [ClickHouse Series: Partition Strategy and Partition Pruning Explained](https://blog.vicwen.app/posts/clickhouse-partition-pruning/)
9. [ClickHouse Series: Primary Key, Sorting Key, and How Granule Indexes Work](https://blog.vicwen.app/posts/clickhouse-primary-sorting-key/)
10. [ClickHouse Series: Best Practices for CollapsingMergeTree and Logical Deletion](https://blog.vicwen.app/posts/clickhouse-collapsingmergetree/)
11. [ClickHouse Series: VersionedCollapsingMergeTree and Data Conflict Resolution](https://blog.vicwen.app/posts/clickhouse-versioned-collapsingmergetree/)
12. [ClickHouse Series: Advanced Uses of AggregatingMergeTree for Real-Time Metrics](https://blog.vicwen.app/posts/clickhouse-aggregatingmergetree/)
13. [ClickHouse Series: Distributed Tables and Distributed Query Architecture](https://blog.vicwen.app/posts/clickhouse-distributed-table-architecture/)
14. [ClickHouse Series: High Availability and Zero-Downtime Upgrades with Replicated Tables](https://blog.vicwen.app/posts/clickhouse-replication-failover/)
15. [ClickHouse Series: Building a Real-Time Data Streaming Pipeline with Kafka](https://blog.vicwen.app/posts/clickhouse-kafka-data-streaming-pipeline/)
16. [ClickHouse Series: Best Practices for Batch Imports (CSV, Parquet, Native Format)](https://blog.vicwen.app/posts/clickhouse-batch-import/)
17. [ClickHouse Series: Integrating ClickHouse with External Data Sources (PostgreSQL)](https://blog.vicwen.app/posts/clickhouse-external-data-integration/)
18. [ClickHouse Series: How to Improve Query Performance? system.query_log and EXPLAIN](https://blog.vicwen.app/posts/clickhouse-query-log-explain/)
19. [ClickHouse Series: Advanced Query Acceleration with Projections](https://blog.vicwen.app/posts/clickhouse-projections-optimization/)
20. [ClickHouse Series: Sampling Queries and Statistical Techniques](https://blog.vicwen.app/posts/clickhouse-sampling-statistics/)
21. [ClickHouse Series: TTL-Based Data Cleanup and Storage Cost Optimization](https://blog.vicwen.app/posts/clickhouse-ttl-storage-management/)
22. [ClickHouse Series: Storage Policies and Tiered Disk Resource Management](https://blog.vicwen.app/posts/clickhouse-storage-policies/)
23. [ClickHouse Series: Table Design and Storage Optimization Details](https://blog.vicwen.app/posts/clickhouse-schemas-storage-improvement/)
24. [ClickHouse Series: Building Visual Monitoring with Grafana](https://blog.vicwen.app/posts/clickhouse-grafana-dashboard/)
25. [ClickHouse Series: Query Optimization Case Studies](https://blog.vicwen.app/posts/clickhouse-select-optimization/)
26. [ClickHouse Series: Integrating with BI Tools (Power BI)](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
27. [ClickHouse Series: ClickHouse Cloud vs Self-Hosted Deployment](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
28. [ClickHouse Series: Database Security and Access Control (RBAC)](https://blog.vicwen.app/posts/clickhouse-security-rbac/)
29. [ClickHouse Series: Deploying a Distributed Architecture on Kubernetes](https://blog.vicwen.app/posts/clickhouse-operator-kubernates/)
30. [ClickHouse Series: Six Core MergeTree Mechanisms Seen from the Source Code](https://blog.vicwen.app/posts/clickhouse-mergetree-sourcecode-introduction/)
