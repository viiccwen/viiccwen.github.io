---
title: "ClickHouse Series: CollapsingMergeTree and Soft Deletes"
published: 2025-08-13
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: ["ClickHouse", "Database", "Ironman"]
category: 'software development'
draft: false
lang: 'en'
---

In traditional OLTP databases, deleting and updating data is routine. But in databases like ClickHouse, which are designed specifically for OLAP scenarios, "soft deletes" and data version control need to be implemented through specially designed storage engines.

**CollapsingMergeTree** is one of the special MergeTree engines provided by ClickHouse to automatically handle inserted records and delete markers (soft deletes).

## What Is CollapsingMergeTree?

CollapsingMergeTree is part of the ClickHouse MergeTree family and is designed for scenarios involving inserted records and delete markers.
It works by using a field called `sign` to mark whether a record is inserted or deleted, and during background Merge operations it automatically cancels out records with opposite `sign` values to achieve the effect of a soft delete.

### Core Features:

* Use the `sign` column to mark record state: `1` means inserted, `-1` means deleted.
* During the Merge phase, matching `1` / `-1` rows under the same Primary Key are automatically canceled out.
* Data deletion is an eventually consistent operation (**not immediate deletion**).

## Syntax

### Create

```sql
CREATE TABLE user_actions
(
    user_id UInt64,
    action String,
    sign Int8
) ENGINE = CollapsingMergeTree(sign)
ORDER BY user_id;
```

### Insert

```sql
-- Insert action records
INSERT INTO user_actions VALUES (1, 'login', 1);
INSERT INTO user_actions VALUES (2, 'purchase', 1);

-- Soft delete the record for user_id = 2
INSERT INTO user_actions VALUES (2, 'purchase', -1);
```

### Query

```sql
SELECT * FROM user_actions;
```

You will still see the data, but after a Merge (`FINAL`):

```sql
OPTIMIZE TABLE user_actions FINAL;
```

The record for `user_id = 2` will be collapsed away, leaving only the data for `user_id = 1`.

## How It Works

1. **No real-time deduplication happens on write**, and all data, including rows with `sign = -1`, is written to disk.
2. **During background Merge operations**, ClickHouse matches records based on the Primary Key:
   * One row with `sign = 1` and one row with `sign = -1` will cancel each other out.
   * If the counts are unbalanced (for example, more `sign = 1` than `sign = -1`), the difference remains.
3. **Queries do not automatically hide records that have not yet been collapsed**, so if you want the final collapsed result, use `FINAL` to guarantee consistency.
4. **Deletion is eventually consistent**, so the original data remains visible until the Merge is finished.

## Use Cases

| Scenario                                | Description                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------- |
| **Soft Delete**                         | You want to keep delete records but do not want deleted data to appear in query results |
| **Data Correction**                     | If bad data was written, you can add a `sign = -1` record to cancel it out |
| **Event Streaming Deduplication**       | Used to remove duplicate event records, such as deduplicating Kafka Stream data |
| **Data Reconciliation and Versioning**  | Combine with a version column for finer-grained correction and reconciliation logic (recommended: `VersionedCollapsingMergeTree`) |

## Differences from ReplacingMergeTree

| Feature                          | CollapsingMergeTree                            | ReplacingMergeTree                                      |
| -------------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| Deduplication mechanism          | Pairwise cancellation through the `sign` field | Keeps the latest version based on the version column (or arbitrarily keeps one row) |
| Delete handling                  | Supports soft deletes (`sign = -1` cancels `sign = 1`) | Does not support delete markers, only replacement with newer versions |
| Best use cases                   | Soft deletes, event stream deduplication, scenarios that need delete records to be written back | Data that needs deduplication but not delete records, such as member data or version replacements in orders |
| Is `FINAL` needed when querying? | Yes (otherwise uncollapsed rows may still appear) | Yes (otherwise undeduplicated rows may still appear) |

## Using `FINAL` in Queries and Performance Notes

Because deduplication and deletion in CollapsingMergeTree happen during the Merge phase, if you need to **see the final consistent result immediately** in a query, you must add the `FINAL` keyword:

```sql
SELECT * FROM user_actions FINAL;
```

### `FINAL` Performance Notes:

* A `FINAL` query forces deduplication work, which can significantly increase query cost on large datasets.
* **Frequent full-table `FINAL` queries are not recommended**. Instead, you can maintain consistency by running `OPTIMIZE TABLE ... FINAL` regularly.

## Design Example

### Event Streaming Deduplication Scenario:

Suppose you receive user behavior events from Kafka, and duplicate writes may occur. You can design the table like this:

```sql
CREATE TABLE user_events
(
    event_time DateTime,
    user_id UInt64,
    event_type String,
    sign Int8
) ENGINE = CollapsingMergeTree(sign)
PARTITION BY toYYYYMM(event_time)
ORDER BY (user_id, event_time);
```

* When data is written, duplicate events will have a `sign = -1` record for deduplication.
* Run `OPTIMIZE` periodically to ensure data correctness.
* If a query cannot wait for merges to finish, use `FINAL` only on a small range.

## Best Practices

| Best Practice                                          | Description                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| Use CollapsingMergeTree only when soft deletes are needed | If not, ReplacingMergeTree is simpler and more effective     |
| Design the Primary Key to uniquely identify a record   | Avoid overly fragmented key design that makes deduplication ineffective |
| Use a Partition Key together with partition pruning    | Partition pruning reduces the Merge scope and lowers resource usage during deduplication |
| Avoid full-table `FINAL` on large tables               | Split data into smaller ranges and run `FINAL` only on specific partitions |
| Consider VersionedCollapsingMergeTree when versioning is required | It can handle more complex deduplication and version-change scenarios |

## Conclusion

CollapsingMergeTree is a powerful tool in ClickHouse for event deduplication and soft delete scenarios. By marking record state through the `sign` column, and combining that with proper Primary Key design and background merge strategy, you can efficiently implement soft deletes and deduplication. However, for workloads with strict query consistency requirements, you need to carefully design your `FINAL` query strategy and regular optimization schedule to avoid performance bottlenecks.

### More ClickHouse Series Posts Coming:

1. [ClickHouse Series: What Is ClickHouse? Differences from Traditional OLAP/OLTP Databases](https://blog.vicwen.app/posts/what-is-clickhouse/)
2. [ClickHouse Series: Why ClickHouse Uses Column-Based Storage? A Core Comparison of Row-Based and Column-Based Storage](https://blog.vicwen.app/posts/clickhouse-column-row-based-storage/)
3. [ClickHouse Series: ClickHouse Storage Engine - MergeTree](https://blog.vicwen.app/posts/clickhouse-mergetree-engine)
4. [ClickHouse Series: How Compression and Data Skipping Indexes Greatly Speed Up Queries](https://blog.vicwen.app/posts/clickhouse-compression-skipping-index/)
5. [ClickHouse Series: ReplacingMergeTree and the Data Deduplication Mechanism](https://blog.vicwen.app/posts/clickhouse-replacingmergetree-deduplication/)
6. [ClickHouse Series: Use Cases for Data Aggregation with SummingMergeTree](https://blog.vicwen.app/posts/clickhouse-summingmergetree-aggregation/)
7. [ClickHouse Series: Real-Time Aggregation Queries with Materialized Views](https://blog.vicwen.app/posts/clickhouse-materialized-view/)
8. [ClickHouse Series: Partition Strategy and Partition Pruning Explained](https://blog.vicwen.app/posts/clickhouse-partition-pruning/)
9. [ClickHouse Series: How Primary Key, Sorting Key, and Granule Indexes Work](https://blog.vicwen.app/posts/clickhouse-primary-sorting-key/)
10. [ClickHouse Series: Best Practices for CollapsingMergeTree and Soft Deletes](https://blog.vicwen.app/posts/clickhouse-collapsingmergetree/)
11. [ClickHouse Series: VersionedCollapsingMergeTree for Version Control and Conflict Resolution](https://blog.vicwen.app/posts/clickhouse-versioned-collapsingmergetree/)
12. [ClickHouse Series: Advanced Real-Time Metrics with AggregatingMergeTree](https://blog.vicwen.app/posts/clickhouse-aggregatingmergetree/)
13. [ClickHouse Series: Distributed Tables and Distributed Query Architecture](https://blog.vicwen.app/posts/clickhouse-distributed-table-architecture/)
14. [ClickHouse Series: Replicated Tables for High Availability and Zero-Downtime Upgrades](https://blog.vicwen.app/posts/clickhouse-replication-failover/)
15. [ClickHouse Series: Building a Real-Time Data Streaming Pipeline with Kafka](https://blog.vicwen.app/posts/clickhouse-kafka-data-streaming-pipeline/)
16. [ClickHouse Series: Best Practices for Batch Import (CSV, Parquet, Native Format)](https://blog.vicwen.app/posts/clickhouse-batch-import/)
17. [ClickHouse Series: Integrating ClickHouse with External Data Sources (PostgreSQL)](https://blog.vicwen.app/posts/clickhouse-external-data-integration/)
18. [ClickHouse Series: How to Improve Query Optimization? Using `system.query_log` and `EXPLAIN`](https://blog.vicwen.app/posts/clickhouse-query-log-explain/)
19. [ClickHouse Series: Advanced Query Acceleration with Projections](https://blog.vicwen.app/posts/clickhouse-projections-optimization/)
20. [ClickHouse Series: Sampling Queries and the Principles Behind Statistical Techniques](https://blog.vicwen.app/posts/clickhouse-sampling-statistics/)
21. [ClickHouse Series: TTL Data Cleanup and Storage Cost Optimization](https://blog.vicwen.app/posts/clickhouse-ttl-storage-management/)
22. [ClickHouse Series: Storage Policies and Disk Tiering Strategy](https://blog.vicwen.app/posts/clickhouse-storage-policies/)
23. [ClickHouse Series: Table Design and Storage Optimization Details](https://blog.vicwen.app/posts/clickhouse-schemas-storage-improvement/)
24. [ClickHouse Series: Building Visual Monitoring with Grafana](https://blog.vicwen.app/posts/clickhouse-grafana-dashboard/)
25. [ClickHouse Series: Query Optimization Case Studies](https://blog.vicwen.app/posts/clickhouse-select-optimization/)
26. [ClickHouse Series: Integrating with BI Tools (Power BI)](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
27. [ClickHouse Series: ClickHouse Cloud vs. Self-Hosted Deployment](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
28. [ClickHouse Series: Database Security and RBAC Implementation](https://blog.vicwen.app/posts/clickhouse-security-rbac/)
29. [ClickHouse Series: Deploying Distributed Architecture on Kubernetes](https://blog.vicwen.app/posts/clickhouse-operator-kubernates/)
30. [ClickHouse Series: Six Core MergeTree Mechanisms Through the Source Code](https://blog.vicwen.app/posts/clickhouse-mergetree-sourcecode-introduction/)
