---
title: "ClickHouse Series: ClickHouse Storage Engine - MergeTree"
published: 2025-08-06
description: ""
image: "https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress"
tags: [ClickHouse, Database, Ironman]
category: "software development"
draft: false
lang: "en"
---

One of the main reasons ClickHouse can query data so quickly is its powerful storage engine, **MergeTree**. In this article, we'll go deeper into what MergeTree is, what problems it solves, and how its different variants (ReplacingMergeTree, SummingMergeTree, and others) handle different data processing scenarios.

## What is MergeTree?

MergeTree is the most fundamental storage engine in ClickHouse. It is responsible for efficiently storing and managing large volumes of write-heavy data, while also supporting fast queries and background merge operations.

### Core concepts:

1. **Partitions**: split data into separate blocks based on a specified field, such as date, so queries need to scan less data.

![](https://clickhouse.com/docs/assets/ideal-img/partitions.4c07acd.2048.png)

> [From the official docs: Table partitions](https://clickhouse.com/docs/partitions)

2. **Primary Key (sorted index)**: defines how data is ordered on disk so queries can quickly locate the relevant range.
3. **Data Parts**: every write creates a Data Part that goes through Sorting, Splitting, Compression, and finally Writing to Disk.

![](https://clickhouse.com/docs/assets/ideal-img/part.d9b96ef.2048.png)

:::note
1. **Sorting**: data is sorted by the Sorting Key (for example, town and street), and a sparse primary index is created.
2. **Splitting**: the sorted data is split into separate columns.
3. **Compression**: each column is compressed independently using algorithms such as LZ4 and ZSTD.
:::

Later, background merges combine small parts into larger, optimized ones.

![](https://clickhouse.com/docs/assets/ideal-img/merges.285da65.2048.png)

> [From the official docs: Table parts](https://clickhouse.com/docs/parts)

## Core characteristics of MergeTree and how Merge works

MergeTree-family engines have the following properties:

1. **Primary Key sorting and sparse index**: the table's primary key determines the order inside each Data Part. However, this index does not point to individual rows; instead, it works on Granules of 8192 rows. This design keeps the primary key index small enough to stay in memory even for enormous datasets, while still allowing fast access to disk blocks.

2. **Flexible partitioning**: partitions can be defined with any expression, and Partition Pruning can automatically skip irrelevant partitions during queries, avoiding unnecessary I/O.

3. **High availability and fault tolerance**: data can be replicated across multiple cluster nodes, supporting high availability, failover, and zero-downtime upgrades.

4. **Sampling and statistics**: MergeTree supports different sampling and statistics mechanisms that help the query optimizer choose faster query paths.

## What problems does MergeTree solve?

* **Large-scale write bottlenecks**: by storing incoming data in small Data Parts first, it avoids the heavy I/O cost of frequently modifying large files.
* **Improved query efficiency**: by sorting with Partition and Primary Key, it can quickly locate the relevant data blocks and avoid full table scans.
* **Compression and deduplication together**: background merges can also compress and deduplicate data, significantly reducing storage usage and query latency.


## Syntax and example

```sql
CREATE TABLE [IF NOT EXISTS] [db.]table_name [ON CLUSTER cluster]
(
    name1 [type1] [[NOT] NULL] [DEFAULT|MATERIALIZED|ALIAS|EPHEMERAL expr1] [COMMENT ...] [CODEC(codec1)] [STATISTICS(stat1)] [TTL expr1] [PRIMARY KEY] [SETTINGS (name = value, ...)],
    name2 [type2] [[NOT] NULL] [DEFAULT|MATERIALIZED|ALIAS|EPHEMERAL expr2] [COMMENT ...] [CODEC(codec2)] [STATISTICS(stat2)] [TTL expr2] [PRIMARY KEY] [SETTINGS (name = value, ...)],
    ...
    INDEX index_name1 expr1 TYPE type1(...) [GRANULARITY value1],
    INDEX index_name2 expr2 TYPE type2(...) [GRANULARITY value2],
    ...
    PROJECTION projection_name_1 (SELECT <COLUMN LIST EXPR> [GROUP BY] [ORDER BY]),
    PROJECTION projection_name_2 (SELECT <COLUMN LIST EXPR> [GROUP BY] [ORDER BY])
) ENGINE = MergeTree()
ORDER BY expr
[PARTITION BY expr]
[PRIMARY KEY expr]
[SAMPLE BY expr]
[TTL expr
    [DELETE|TO DISK 'xxx'|TO VOLUME 'xxx' [, ...] ]
    [WHERE conditions]
    [GROUP BY key_expr [SET v1 = aggr_func(v1) [, v2 = aggr_func(v2) ...]] ] ]
[SETTINGS name = value, ...]
```

### Create table

```sql
CREATE TABLE user_events
(
    EventDate Date,
    UserID UInt64,
    EventType String,
    EventValue Float32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(EventDate)
ORDER BY (EventDate, UserID);
```

### Insert data

```sql
INSERT INTO user_events VALUES ('2025-08-10', 1001, 'click', 1.0);
INSERT INTO user_events VALUES ('2025-08-10', 1002, 'view', 1.0);
INSERT INTO user_events VALUES ('2025-08-11', 1001, 'purchase', 299.99);
```

### Query data

```sql
SELECT *
FROM user_events
WHERE EventDate = '2025-08-10'
  AND UserID = 1001;
```

This query first prunes to the 2025-08 partition based on the Partition Key, then uses the Primary Key `(EventDate, UserID)` to hit the relevant Granules directly, greatly reducing the amount of data scanned.

### Extra: specifying index granularity

If you want finer control over the Primary Index granularity, you can use the `index_granularity` setting:

```sql
ENGINE = MergeTree()
PARTITION BY toYYYYMM(EventDate)
ORDER BY (EventDate, UserID)
SETTINGS index_granularity = 8192;
```

> 8192 is the default Granule size. If your query patterns are more scattered, you can lower it to a smaller value such as 4096 to increase hit rate, though that will also increase index size.

I will explain granularity in more detail later in the series. Since that is extra context, you can come back here once you have a better sense of what granularity means and why it matters.


## Special variants in the MergeTree family

Depending on the business need, ClickHouse has created many MergeTree variants:

| Storage engine | Characteristics and use cases |
| -------------------------------- | ---------------------------------------------- |
| **ReplacingMergeTree** | Automatically replaces duplicate rows using a specified field such as a version column, which is useful when deduplication is needed. |
| **SummingMergeTree** | Automatically sums numeric columns with the same Primary Key during merges, which is useful for aggregation tables. |
| **AggregatingMergeTree** | Performs more complex aggregation on `AggregateFunction` types, suitable for real-time metrics. |
| **CollapsingMergeTree** | Uses a `sign` column to mark insert/delete state and automatically handles logical deletion and conflict resolution. |
| **VersionedCollapsingMergeTree** | Builds on CollapsingMergeTree and adds version-aware deduplication. |

## How Merge works and its performance impact

MergeTree runs Merge operations in the background, merging multiple small Data Parts into larger ones while sorting, compressing, and deduplicating them.

* **Balancing merge frequency and performance**: Merge operations consume I/O resources, so tuning merge-related settings such as `max_parts_to_merge_at_once` helps balance read and write performance.
* **Mutation operations**: ClickHouse also supports UPDATE and DELETE during the merge stage, but these are non-real-time operations and are better suited to analytics workloads.

## Use cases

* **Log analysis**: use date as the Partition and URL or IP as the Primary Key to quickly query logs for a given time range and condition.
* **User behavior tracking**: use `ReplacingMergeTree` to deduplicate rows and `SummingMergeTree` to aggregate click behavior.
* **IoT sensor data platforms**: ingest large amounts of sensor data and use `AggregatingMergeTree` to compute metrics in real time.

## Closing thoughts

MergeTree is the foundation of ClickHouse's high-performance storage and query capabilities. Through partitioning, sorting, and background merge operations, it enables both write-heavy ingestion and fast queries at massive scale. Choosing the right MergeTree variant for each workload can significantly improve system performance.

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
