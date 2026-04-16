---
title: "ClickHouse Series: Sampling Queries and Statistical Techniques"
published: 2025-08-23
description: ""
image: "https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress"
tags: [ClickHouse, Database, Ironman]
category: "software development"
draft: false
lang: "en"
---

When dealing with PB-scale datasets, how can you get an approximate result quickly without distorting the statistical conclusion? ClickHouse provides an efficient **sampling query technique** that can deliver results with "**95% accuracy using just 1% of the data**."

## What Is Sampling?

Sampling is a technique that scans only part of the data for statistical estimation. It is mainly used for:

* Real-time dashboard metrics
* Approximate statistical queries over PB-scale data
* Scenarios where a full table scan would take too long

ClickHouse implements a sampling mechanism that combines order and randomness through a "sampling key."

## How It Works

1. The `SAMPLE BY` column is used as the hash-distribution basis.
2. At query time, `SAMPLE K` lets ClickHouse scan only K percent of the data.
3. Sampling is **deterministic**, so the result does not change under the same query conditions.
4. When different tables share the same sampling key, sampling consistency can be preserved across JOIN/IN subqueries.

## SAMPLE Syntax and Differences

### 1. `SAMPLE k`

* `k` is a floating-point value between 0 and 1.
* The query randomly selects about `k` of the data granules for processing.
* Aggregated values must be manually multiplied by the inverse factor to restore an approximate result.

```sql
SELECT Action, count() * 10 AS cnt
FROM user_events
SAMPLE 0.1
GROUP BY Action;
```

This SQL reads only 10% of the data, then multiplies the result by 10 to restore the estimate.

### 2. `SAMPLE N`

* `N` is the approximate target number of rows to process.
* ClickHouse scans enough granules to cover at least `N` rows.
* Use the `\_sample\_factor` virtual column to automatically estimate the scaling factor.

```sql
SELECT sum(PageViews * _sample_factor)
FROM visits
SAMPLE 10000000;
```

```sql
SELECT sum(_sample_factor)
FROM visits
SAMPLE 10000000;
```

### 3. `SAMPLE k OFFSET m`

* `k`: sampling ratio
* `m`: sampling offset (between 0 and 1)
* Useful when you want to avoid different queries overlapping on the same data blocks

```sql
SELECT *
FROM visits
SAMPLE 0.1 OFFSET 0.5;
```

## Specify a Sampling Key When Creating the Table

Only **MergeTree-family table engines** support sampling, and you must specify a sampling key when creating the table.

```sql
CREATE TABLE user_events
(
    EventDate DateTime,
    UserID UInt64,
    Action String
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(EventDate)
ORDER BY (UserID, EventDate)
SAMPLE BY intHash64(UserID);
```

Choosing a high-cardinality and evenly distributed column such as `UserID` for `SAMPLE BY` is the key.

## Example: Cutting Query Time from 20 Seconds to 2 Seconds

### Original query (full table scan)

```sql
SELECT Action, count() FROM user_events GROUP BY Action;
-- Query took: 20 seconds
```

### Sampling query (`SAMPLE 0.1`)

```sql
SELECT Action, count() * 10 FROM user_events SAMPLE 0.1 GROUP BY Action;
-- Query took: 2 seconds
```

Compared with a full table scan, the sampling query is 10 times faster, while the error rate of the statistical result stays within 5%.

## Sampling Query Validation

You can use `EXPLAIN ESTIMATE` to estimate how much data a query will scan.

```sql
EXPLAIN ESTIMATE SELECT * FROM user_events SAMPLE 0.1;
```

| parts | marks  | rows                     |
| ----- | ------ | ------------------------ |
| 10/10 | 100/10 | 100,000,000 / 10,000,000 |

## Common Questions and Mistakes

| Problem                      | Suggested fix                                |
| --------------------------- | ------------------------------------------- |
| SAMPLE query does not work, still scans the full table | You must specify a `SAMPLE BY` key when creating the table. |
| Sampling ratio is too small, so the statistical result has large error | A range of `SAMPLE 0.05` to `0.2` is usually better. |
| Wrong `SAMPLE BY` column, so the sampling result is biased | Choose a uniformly distributed column such as `UserID` to avoid bias. |

## Conclusion

Sampling is one of ClickHouse's most powerful query acceleration techniques for big-data scenarios. With just a simple `SAMPLE BY` and sampling percentage, you can easily get approximate query results in seconds while greatly reducing system I/O and compute pressure.

### More Posts in This Series:

1. [ClickHouse Series: What Is ClickHouse? How It Differs from Traditional OLAP/OLTP Databases](https://blog.vicwen.app/posts/what-is-clickhouse/)
2. [ClickHouse Series: Why ClickHouse Uses Column-Based Storage? Core Differences Between Row-Based and Column-Based Storage](https://blog.vicwen.app/posts/clickhouse-column-row-based-storage/)
3. [ClickHouse Series: ClickHouse Storage Engine - MergeTree](https://blog.vicwen.app/posts/clickhouse-mergetree-engine)
4. [ClickHouse Series: How Compression and Data Skipping Indexes Dramatically Speed Up Queries](https://blog.vicwen.app/posts/clickhouse-compression-skipping-index/)
5. [ClickHouse Series: ReplacingMergeTree and Data Deduplication](https://blog.vicwen.app/posts/clickhouse-replacingmergetree-deduplication/)
6. [ClickHouse Series: Practical Uses of SummingMergeTree for Aggregation](https://blog.vicwen.app/posts/clickhouse-summingmergetree-aggregation/)
7. [ClickHouse Series: Real-Time Aggregation with Materialized Views](https://blog.vicwen.app/posts/clickhouse-materialized-view/)
8. [ClickHouse Series: Partition Strategy and Partition Pruning Explained](https://blog.vicwen.app/posts/clickhouse-partition-pruning/)
9. [ClickHouse Series: Primary Key, Sorting Key, and How Granule Indexes Work](https://blog.vicwen.app/posts/clickhouse-primary-sorting-key/)
10. [ClickHouse Series: Best Practices for CollapsingMergeTree and Logical Deletes](https://blog.vicwen.app/posts/clickhouse-collapsingmergetree/)
11. [ClickHouse Series: VersionedCollapsingMergeTree and Data Conflict Resolution](https://blog.vicwen.app/posts/clickhouse-versioned-collapsingmergetree/)
12. [ClickHouse Series: Advanced Uses of AggregatingMergeTree for Real-Time Metrics](https://blog.vicwen.app/posts/clickhouse-aggregatingmergetree/)
13. [ClickHouse Series: Distributed Tables and Distributed Query Architecture](https://blog.vicwen.app/posts/clickhouse-distributed-table-architecture/)
14. [ClickHouse Series: High Availability and Zero-Downtime Upgrades with Replicated Tables](https://blog.vicwen.app/posts/clickhouse-replication-failover/)
15. [ClickHouse Series: Building a Real-Time Data Streaming Pipeline with Kafka](https://blog.vicwen.app/posts/clickhouse-kafka-data-streaming-pipeline/)
16. [ClickHouse Series: Best Practices for Batch Imports (CSV, Parquet, Native Format)](https://blog.vicwen.app/posts/clickhouse-batch-import/)
17. [ClickHouse Series: Integrating ClickHouse with External Data Sources (PostgreSQL)](https://blog.vicwen.app/posts/clickhouse-external-data-integration/)
18. [ClickHouse Series: How to Improve Query Performance with system.query_log and EXPLAIN](https://blog.vicwen.app/posts/clickhouse-query-log-explain/)
19. [ClickHouse Series: Advanced Query Acceleration with Projections](https://blog.vicwen.app/posts/clickhouse-projections-optimization/)
20. [ClickHouse Series: Sampling Queries and Statistical Techniques](https://blog.vicwen.app/posts/clickhouse-sampling-statistics/)
21. [ClickHouse Series: TTL Data Cleanup and Storage Cost Optimization](https://blog.vicwen.app/posts/clickhouse-ttl-storage-management/)
22. [ClickHouse Series: Storage Policies and Tiered Disk Resource Management](https://blog.vicwen.app/posts/clickhouse-storage-policies/)
23. [ClickHouse Series: Table Design and Storage Optimization Details](https://blog.vicwen.app/posts/clickhouse-schemas-storage-improvement/)
24. [ClickHouse Series: Building Visual Monitoring with Grafana](https://blog.vicwen.app/posts/clickhouse-grafana-dashboard/)
25. [ClickHouse Series: Query Optimization Case Studies](https://blog.vicwen.app/posts/clickhouse-select-optimization/)
26. [ClickHouse Series: Integrating with BI Tools (Power BI)](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
27. [ClickHouse Series: Comparing ClickHouse Cloud and Self-Hosted Deployments](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
28. [ClickHouse Series: Database Security and RBAC](https://blog.vicwen.app/posts/clickhouse-security-rbac/)
29. [ClickHouse Series: Deploying a Distributed Architecture on Kubernetes](https://blog.vicwen.app/posts/clickhouse-operator-kubernates/)
30. [ClickHouse Series: Six Core MergeTree Mechanisms Seen from the Source Code](https://blog.vicwen.app/posts/clickhouse-mergetree-sourcecode-introduction/)
