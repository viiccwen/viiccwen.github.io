---
title: "ClickHouse Series: Table Design and Storage Optimization Details"
published: 2025-08-26
description: ""
image: "https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress"
tags: ["ClickHouse", "Database", "Ironman"]
category: "software development"
draft: false
lang: "en"
---

In ClickHouse, table design is not just about defining columns at random. Different column properties, type choices, and compression strategies directly affect **storage usage** and **query performance**.

Today, let's dig into a few details that are easy to overlook in real projects:

* Default vs Nullable storage differences
* Type narrowing
* How much LowCardinality can save
* Codec compression tricks
* Best practices for column design

## Default Value vs Nullable

In ClickHouse, `Nullable(T)` stores an extra **null bitmap** for each row, one bit per row. Even if most values are not NULL, there is still storage overhead.

If a column is almost never NULL, using `DEFAULT` is more space-efficient.

| Setting | Storage usage | Query performance | Suitable scenario |
| -------- | ------------- | ----------------- | ----------------- |
| Nullable | +1 bit/row    | No obvious difference | Frequent missing data |
| Default  | No extra bitmap | No obvious difference | Column almost always has a value |

**Recommendation**:

```sql
-- Not recommended
age Nullable(UInt8)

-- Recommended
age UInt8 DEFAULT 0
```

## Type Narrowing

ClickHouse's columnar storage lets us save a lot of space by choosing smaller types.

**Integer ranges**:

* `UInt8` -> 0~255
* `UInt16` -> 0~65535
* `UInt32` -> common IDs
* `UInt64` -> very large integer IDs

**Floating point and Decimal**:

* Monetary values with two decimal places -> `Decimal(9, 2)`
* High-precision scientific calculation -> `Float64`

**Dates and time**:

* `Date` (2 bytes)
* `DateTime` (4 bytes)

## LowCardinality for Strings

For strings with **high repetition** such as regions or statuses, `LowCardinality(String)` uses dictionary encoding and greatly reduces duplicate storage.

```sql
ALTER TABLE orders
MODIFY COLUMN status LowCardinality(String);
```

| Column type | Space usage when repetition is high | Space usage when repetition is low |
| ----------- | ----------------------------------- | ---------------------------------- |
| String | High | High |
| LowCardinality(String) | Low | Slightly higher |

## FixedString Space Optimization

This is useful for fixed-length fields such as codes or hashes. Compression is efficient, but values shorter than the fixed size are padded with zeros, which can waste space.

```sql
code FixedString(8)
```

## Codec Compression Tricks

ClickHouse lets you configure compression per column, for example:

* `ZSTD`: high compression ratio
* `DoubleDelta`: suitable for time-series numbers
* `Delta`: suitable for date columns

```sql
CREATE TABLE events
(
    id UInt32 CODEC(ZSTD(3)),
    date Date CODEC(DoubleDelta)
) ENGINE = MergeTree();
```

## Best Practices for Column Design

1. **Put high-cardinality columns first** -> improve index efficiency
2. **Split sparse columns into separate tables** -> reduce wasted space from NULL-like sparsity
3. **Use Nested / Tuple** -> reduce column count and storage overhead

## Example Design

```sql
CREATE TABLE user_events
(
    EventDate Date DEFAULT today(),
    UserID UInt32,
    Action LowCardinality(String),
    Version UInt8 DEFAULT 1
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(EventDate)
ORDER BY (EventDate, UserID);
```

* `EventDate` uses `DEFAULT`, so there is no Nullable bitmap
* `Action` uses `LowCardinality` to reduce duplicate string storage
* `Version` uses `UInt8` with a default value

## Conclusion

Table design is the first step in ClickHouse cost optimization and performance tuning.

By choosing column properties wisely, such as `DEFAULT`, type selection, `LowCardinality`, and `CODEC`, you can **save several times the storage space** on the same hardware and significantly improve query speed.

### ClickHouse Series Updates:
1. [ClickHouse Series: What Is ClickHouse? How It Differs from Traditional OLAP/OLTP Databases](https://blog.vicwen.app/posts/what-is-clickhouse/)
2. [ClickHouse Series: Why Does ClickHouse Choose Column-Based Storage? The Core Difference Between Row-Based and Column-Based Storage](https://blog.vicwen.app/posts/clickhouse-column-row-based-storage/)
3. [ClickHouse Series: ClickHouse Storage Engine - MergeTree](https://blog.vicwen.app/posts/clickhouse-mergetree-engine)
4. [ClickHouse Series: How Compression and Data Skipping Indexes Greatly Speed Up Queries](https://blog.vicwen.app/posts/clickhouse-compression-skipping-index/)
5. [ClickHouse Series: ReplacingMergeTree and Data Deduplication](https://blog.vicwen.app/posts/clickhouse-replacingmergetree-deduplication/)
6. [ClickHouse Series: Use Cases for SummingMergeTree Aggregation](https://blog.vicwen.app/posts/clickhouse-summingmergetree-aggregation/)
7. [ClickHouse Series: Real-Time Aggregation with Materialized Views](https://blog.vicwen.app/posts/clickhouse-materialized-view/)
8. [ClickHouse Series: Partitioning Strategy and Partition Pruning Explained](https://blog.vicwen.app/posts/clickhouse-partition-pruning/)
9. [ClickHouse Series: How Primary Key, Sorting Key, and Granule Indexing Work](https://blog.vicwen.app/posts/clickhouse-primary-sorting-key/)
10. [ClickHouse Series: Best Practices for CollapsingMergeTree and Logical Deletes](https://blog.vicwen.app/posts/clickhouse-collapsingmergetree/)
11. [ClickHouse Series: VersionedCollapsingMergeTree, Version Control, and Conflict Resolution](https://blog.vicwen.app/posts/clickhouse-versioned-collapsingmergetree/)
12. [ClickHouse Series: Advanced Use of AggregatingMergeTree for Real-Time Metrics](https://blog.vicwen.app/posts/clickhouse-aggregatingmergetree/)
13. [ClickHouse Series: Distributed Tables and Distributed Query Architecture](https://blog.vicwen.app/posts/clickhouse-distributed-table-architecture/)
14. [ClickHouse Series: High Availability and Zero-Downtime Upgrades with Replicated Tables](https://blog.vicwen.app/posts/clickhouse-replication-failover/)
15. [ClickHouse Series: Building a Real-Time Data Streaming Pipeline with Kafka](https://blog.vicwen.app/posts/clickhouse-kafka-data-streaming-pipeline/)
16. [ClickHouse Series: Best Practices for Batch Imports (CSV, Parquet, Native Format)](https://blog.vicwen.app/posts/clickhouse-batch-import/)
17. [ClickHouse Series: Integrating ClickHouse with External Data Sources (PostgreSQL)](https://blog.vicwen.app/posts/clickhouse-external-data-integration/)
18. [ClickHouse Series: How to Improve Query Performance with system.query_log and EXPLAIN](https://blog.vicwen.app/posts/clickhouse-query-log-explain/)
19. [ClickHouse Series: Advanced Query Acceleration with Projections](https://blog.vicwen.app/posts/clickhouse-projections-optimization/)
20. [ClickHouse Series: Sampling Queries and Statistical Techniques](https://blog.vicwen.app/posts/clickhouse-sampling-statistics/)
21. [ClickHouse Series: TTL Data Cleanup and Storage Cost Optimization](https://blog.vicwen.app/posts/clickhouse-ttl-storage-management/)
22. [ClickHouse Series: Storage Policies and Disk Tiering Strategy](https://blog.vicwen.app/posts/clickhouse-storage-policies/)
23. [ClickHouse Series: Table Design and Storage Optimization Details](https://blog.vicwen.app/posts/clickhouse-schemas-storage-improvement/)
24. [ClickHouse Series: Integrating Grafana for Visual Monitoring](https://blog.vicwen.app/posts/clickhouse-grafana-dashboard/)
25. [ClickHouse Series: Query Optimization Case Studies](https://blog.vicwen.app/posts/clickhouse-select-optimization/)
26. [ClickHouse Series: Integrating with BI Tools (Power BI)](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
27. [ClickHouse Series: Comparing ClickHouse Cloud and Self-Hosted Deployments](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
28. [ClickHouse Series: Database Security and RBAC Implementation](https://blog.vicwen.app/posts/clickhouse-security-rbac/)
29. [ClickHouse Series: Deploying a Distributed Architecture on Kubernetes](https://blog.vicwen.app/posts/clickhouse-operator-kubernates/)
30. [ClickHouse Series: Six Core MergeTree Mechanisms from the Source Code](https://blog.vicwen.app/posts/clickhouse-mergetree-sourcecode-introduction/)
