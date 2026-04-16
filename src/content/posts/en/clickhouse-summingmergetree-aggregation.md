---
title: "ClickHouse Series: SummingMergeTree for Data Aggregation"
published: 2025-08-09
description: ""
image: "https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress"
tags: [ClickHouse, Database, Ironman]
category: "software development"
draft: false
lang: "en"
---

When you spend a lot of time on dashboards and reports, you quickly run into the need for numeric totals and grouped aggregation statistics, like daily active users, hourly traffic metrics, and real-time counters. ClickHouse offers an extremely efficient aggregation tool for exactly this use case: **SummingMergeTree**.

## What is SummingMergeTree?

SummingMergeTree is a MergeTree-family engine in ClickHouse. During the merge stage, it automatically sums numeric columns that share the same `Primary Key`, helping you build high-performance pre-aggregated tables very quickly.

### Characteristics:

* **Automatic numeric summation**: rows with the same Primary Key are summed during merges.
* **Not real-time aggregation**: summation happens in the background merge stage.
* **No need to write aggregation logic**; a simple table definition is enough.


## Syntax and example

```sql
CREATE TABLE daily_metrics
(
    date Date,
    page String,
    views UInt32,
    clicks UInt32
) ENGINE = SummingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (date, page);
```

* All **numeric columns** participate in summation by default.
* String columns only participate in GROUP BY and are not aggregated.

```sql
INSERT INTO daily_metrics VALUES ('2025-08-01', 'Home', 100, 10);
INSERT INTO daily_metrics VALUES ('2025-08-01', 'Home', 200, 25);
INSERT INTO daily_metrics VALUES ('2025-08-01', 'Contact', 50, 5);
```

A regular query still shows all rows before the background merge runs:

```sql
SELECT * FROM daily_metrics WHERE date = '2025-08-01';
```

| date       | page    | views | clicks |
| ---------- | ------- | ----- | ------ |
| 2025-08-01 | Home    | 100   | 10     |
| 2025-08-01 | Home    | 200   | 25     |
| 2025-08-01 | Contact | 50    | 5      |

After background Merge runs, or if you force Optimize:

```sql
OPTIMIZE TABLE daily_metrics FINAL;
```

Querying again gives:

| date       | page    | views | clicks |
| ---------- | ------- | ----- | ------ |
| 2025-08-01 | Home    | 300   | 35     |
| 2025-08-01 | Contact | 50    | 5      |


## Use cases

| Scenario | Description |
| ----------------------------------- | ---------------------------------------------------------------- |
| **Real-time counters** | For cumulative stats like API calls or product page views. |
| **Batch pre-aggregation** | Turn large fact tables into pre-aggregated tables to avoid expensive real-time computation. |
| **Traffic and activity aggregation** | Log analysis, web traffic statistics, and user behavior metrics such as PV and UV. |
| **Pairing with Materialized View** | Use a Materialized View to stream raw data into a SummingMergeTree table for real-time aggregation. |


## GROUP BY rules

The aggregation logic of SummingMergeTree is based on the **Primary Key columns**, and numeric columns are summed.

* `ORDER BY` columns = GROUP BY key
* Only numeric columns (`Int`, `Float`) are automatically summed
* String, date, and other columns only participate in grouping and are not aggregated

If the `Primary Key` is designed poorly, for example if it is too fine-grained or includes unnecessary columns, the aggregation effect will break down and statistics may not merge correctly.


## Advanced: real-time aggregation with Materialized View

```sql
CREATE TABLE raw_events
(
    event_time DateTime,
    page String,
    views UInt32,
    clicks UInt32
) ENGINE = MergeTree
ORDER BY (event_time, page);

CREATE MATERIALIZED VIEW mv_daily_metrics
TO daily_metrics
AS SELECT
    toDate(event_time) AS date,
    page,
    sum(views) AS views,
    sum(clicks) AS clicks
FROM raw_events
GROUP BY date, page;
```

With this setup, every time data is written into `raw_events`, ClickHouse calculates the aggregated result in real time and writes it into `daily_metrics` (SummingMergeTree).


## Differences between SummingMergeTree and AggregatingMergeTree

| Feature | SummingMergeTree | AggregatingMergeTree |
| ------- | ---------------- | -------------------------------------------------- |
| Supported aggregation | Only SUM for numeric columns | Supports all `AggregateFunction` types (SUM, AVG, COUNT, MIN, MAX) |
| Aggregation logic | Sum during background merges | Uses `AggregateFunction`-typed values and aggregation functions |
| Design complexity | Simple, suitable for counters and plain summation | More complex, suitable for metrics, quantiles, and deduplicated statistics |
| Write performance | Higher, because no special types are required | Lower, because data must be written as `AggregateFunction` values |


## Best practices and notes

1. **Primary Key design determines aggregation quality**: `ORDER BY` should be designed carefully and should only contain columns used for `GROUP BY`.
2. **Avoid column-name confusion**: non-numeric columns will not be summed, but wrong types or confusing names can still lead to bad statistics.
3. **Insert order does not affect the result**: summation happens during merge, so streaming writes do not need to be sorted.
4. **Run `OPTIMIZE FINAL` regularly**: if you need more immediate consistency, force merges periodically to ensure queries return aggregated results.
5. **Materialized View is the best partner for real-time aggregation**: it can stream raw data into `SummingMergeTree` efficiently.

## Closing thoughts

SummingMergeTree gives you a simple yet powerful way to aggregate data, and it is especially well suited to counters, traffic metrics, and pre-aggregated tables. With a sensible Primary Key design and a Materialized View, query performance can improve dramatically.

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
