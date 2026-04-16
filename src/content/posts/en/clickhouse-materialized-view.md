---
title: "ClickHouse Series: Materialized Views for Real-Time Aggregation Queries"
published: 2025-08-10
description: ""
image: "https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress"
tags: [ClickHouse, Database, Ironman]
category: "software development"
draft: false
lang: "en"
---

In OLAP systems, "real-time aggregation" and "precomputation" are the core strategies for speeding up queries and reducing resource usage. ClickHouse provides powerful **Materialized Views** that can write complex query results into tables in real time and significantly reduce the computational burden at query time.


## What is a Materialized View?

A Materialized View is a **query view with persisted results**. When data is inserted into the source table, ClickHouse automatically evaluates the defined SELECT query and writes the result into the target table.

In simple terms, it is a mechanism for "**automatically triggered insert + aggregation query + write to summary table**."

### Characteristics:

* When data is INSERTed into the source table, the computed result is written to the target table automatically.
* The target table is usually `SummingMergeTree` or `AggregatingMergeTree`.
* It only computes results for newly inserted data and does not re-scan old data.


## Basic syntax and example

### 1. Create the source table (raw data table)

```sql
CREATE TABLE events
(
    event_time DateTime,
    page String,
    user_id UInt64,
    views UInt32
) ENGINE = MergeTree
ORDER BY (event_time, page);
```

### 2. Create the target table (aggregate table)

```sql
CREATE TABLE daily_page_views
(
    date Date,
    page String,
    total_views UInt32
) ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (date, page);
```

### 3. Create the Materialized View

```sql
CREATE MATERIALIZED VIEW mv_daily_page_views
TO daily_page_views
AS SELECT
    toDate(event_time) AS date,
    page,
    sum(views) AS total_views
FROM events
GROUP BY date, page;
```

Every time data is written into the `events` table, ClickHouse automatically calculates the daily page views and writes them into `daily_page_views`.


## How it works

1. INSERT -> `events`
2. The Materialized View triggers a SELECT plus aggregation
3. The result is INSERTed into `daily_page_views`
4. Queries on `daily_page_views` read the pre-aggregated result directly


## Use cases

| Use case | Description |
| -------------------------------------------- | ---------------------------------------- |
| **High-frequency summary tables for dashboards or BI reports** | Precompute expensive aggregation results into a smaller table so queries only need to scan a compact dataset. |
| **Real-time event streaming aggregation** | Combine Kafka + MV to track clicks, views, and other metrics in real time. |
| **Metric storage and aggregation** | Compute metrics in real time with Materialized Views, which works well for IoT and monitoring platforms. |
| **Pairing with ReplacingMergeTree or SummingMergeTree** | The target table can use deduplication or aggregation engines to further optimize storage. |


## Design considerations and limitations of Materialized Views

### 1. **The target table must already exist**

Materialized Views act as a trigger that writes into the target table, so the target table must be created first.

### 2. **Only new data is computed**

MV only aggregates newly inserted data. It does not backfill older data automatically. If historical data changes in the source table, you must recalculate it manually.

### 3. **INSERT triggers the query, so query performance depends on target table design**

The target table should use the appropriate MergeTree engine (`Summing`, `Aggregating`, or `Replacing`) depending on the workload.

### 4. **No direct UPDATE/DELETE support**

MV only triggers on INSERT events. If you need backfills or deletions, use `ReplacingMergeTree` or mutations.


## Advanced: using POPULATE to compute historical data once

If you want the historical data from the source table to be computed into the target table when the Materialized View is created, you can use the `POPULATE` keyword.

```sql
CREATE MATERIALIZED VIEW mv_daily_page_views POPULATE
TO daily_page_views
AS SELECT
    toDate(event_time) AS date,
    page,
    sum(views) AS total_views
FROM events
GROUP BY date, page;
```

### Notes:

* `POPULATE` runs only once at creation time and does not keep working afterward.
* If new historical data is inserted into the source table later, you need to backfill it yourself.


## Materialized View vs View vs LIVE View

| Type | Description | Main purpose |
| --------------------- | ----------------------------------- | -------------------------- |
| **Materialized View** | Materializes query results into a table when data is inserted | Real-time aggregation and summarization |
| **View** | Executes SELECT at query time with no stored data | Simplify complex query syntax |
| **LIVE View** | Automatically pushes query results based on data updates, similar to a streaming query | Real-time dynamic queries, but heavier and not recommended for large-scale data |


## Best practices and performance advice

| Practice | Description |
| ------------------------------ | -------------------------------------- |
| **Use SummingMergeTree for efficient sum tables** | Use MV to roll large raw data into a smaller summary table and improve query performance. |
| **Materialized Views support multi-level aggregation** | You can chain multiple MVs into layered aggregations (daily -> weekly -> monthly) to reduce real-time compute costs. |
| **Use Partition Key wisely for large tables** | Partition the aggregated result by date or business dimension to reduce I/O on writes and queries. |
| **Be careful with insert overhead** | Every insert triggers a subquery, so a very complex MV can slow down writes. |
| **Integrate with Kafka Engine for stream aggregation** | MV can consume from Kafka sources directly and write aggregated results automatically. |


## Closing thoughts

Materialized Views provide an "automatic compute, real-time write" aggregation mechanism that lets ClickHouse keep query performance high even under heavy ingestion. With sensible source table design, target table design, aggregation logic, and engine selection, Materialized Views can become a powerful accelerator for analytics workloads.

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
