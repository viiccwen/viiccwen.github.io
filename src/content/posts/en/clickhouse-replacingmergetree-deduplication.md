---
title: "ClickHouse Series: ReplacingMergeTree and Data Deduplication"
published: 2025-08-08
description: ""
image: "https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress"
tags: [ClickHouse, Database, Ironman]
category: "software development"
draft: false
lang: "en"
---

In big-data environments, data duplication is a common and annoying problem. This is especially true in ETL pipelines or real-time data ingestion such as Kafka streams, where duplicate rows can seriously distort statistics and hurt query performance. ClickHouse provides a simple but powerful deduplication mechanism: the **ReplacingMergeTree** storage engine.

This article walks through how ReplacingMergeTree works, where it fits, and the best practices for using it.

## What is ReplacingMergeTree?

ReplacingMergeTree is one of the MergeTree family engines in ClickHouse (~the family is huge~). During background Merge operations, it can automatically remove duplicate rows based on a specified field such as a version column, keeping the newest version or the first inserted row.

### How it works:

1. When data is INSERTed, it is **not deduplicated immediately**. Instead, it is written to disk as Data Parts.
2. During **background Merge operations**, ClickHouse compares rows by Primary Key. If duplicate records with the same Primary Key are found, it keeps the row with the largest version value (or any row if no version is specified).
3. Deduplication is **not real-time**. It is eventually consistent, and the actual deduplication point happens during the Merge stage.

## Syntax and example

```sql
CREATE TABLE user_profiles
(
    user_id UInt64,
    profile_version UInt32,
    name String,
    email String
) ENGINE = ReplacingMergeTree(profile_version)
ORDER BY user_id;
```

* `profile_version` is the version column that decides which row to keep during deduplication.
* If no version is specified, the system keeps one row at random (order is not guaranteed). It is basically a Russian roulette approach.

```sql
INSERT INTO user_profiles VALUES (1, 1, 'Alice', 'alice_v1@example.com');
INSERT INTO user_profiles VALUES (1, 2, 'Alice', 'alice_v2@example.com');
INSERT INTO user_profiles VALUES (2, 1, 'Bob', 'bob@example.com');
```

When querying, you may still see duplicates, because deduplication has not happened yet through Merge:

```sql
SELECT * FROM user_profiles WHERE user_id = 1;
```

Result:

| user_id | profile_version | name  | email |
| -------- | ---------------- | ----- | ---------------------------------------------------- |
| 1        | 1                | Alice | [alice_v1@example.com](mailto:alice_v1@example.com) |
| 1        | 2                | Alice | [alice_v2@example.com](mailto:alice_v2@example.com) |

After using `FINAL` in the query, the result reflects the latest deduplicated data:

```sql
OPTIMIZE TABLE user_profiles FINAL;
```

```sql
SELECT * FROM user_profiles FINAL WHERE user_id = 1;
```

:::important
`OPTIMIZE` forces a merge of Data Parts, combining many small parts into larger ones and triggering deduplication (ReplacingMergeTree) or aggregation (SummingMergeTree) logic at the same time.

**What actually changes is the Data Parts on disk**, and the merge result is permanent because it is written back to disk.
:::

After that, only the row with `version = 2` remains in the result.

## Relationship between ReplacingMergeTree and the Primary Key

* **Deduplication is based on the `Primary Key`**, so the `ORDER BY` columns used when creating the table must be designed correctly.
* If the `ORDER BY` columns cannot uniquely identify a record, ReplacingMergeTree may keep the wrong version of the data.

### Example:

```sql
ORDER BY (user_id, profile_version)
```

In this case, ReplacingMergeTree cannot deduplicate automatically, because the Primary Key already contains the version value and treats each version as a different row.

The correct design should be:

```sql
ORDER BY user_id
```

## When to use ReplacingMergeTree

| Scenario | Description |
| -------------------------- | ----------------------------------- |
| **Deduplicating replayed Kafka / stream data** | Automatically deduplicates data when messages are consumed multiple times or replayed under at-least-once guarantees. |
| **Filtering duplicates during batch import** | Prevents duplicate rows when ETL loads the same data more than once. |
| **Versioned data history** | Keeps the latest version, while older versions are removed during merges. |
| **Data correction** | If data was written incorrectly, a later row with a higher version can overwrite the bad record. |

## ReplacingMergeTree vs. AggregatingMergeTree

| Feature | ReplacingMergeTree | AggregatingMergeTree |
| -------- | ---------------------------------- | --------------------------------- |
| Core behavior | Deduplicates by `Primary Key` and keeps the row with the largest `version` | Merges rows by computing `AggregateFunction` values |
| Version column | Optional; if omitted, one row is kept arbitrarily | No version column needed |
| Use case | Removing duplicates and keeping latest data | Pre-aggregated data such as behavioral metrics or counters |
| Merge process | Rows with the same key are merged into one during merge | Aggregation functions are applied to `AggregateFunction` values during merge |

## Common mistakes and best practices

### Common mistakes:

1. **Thinking deduplication happens on insert** -> **Wrong!** ReplacingMergeTree deduplicates **during background merges**.
2. **Choosing the wrong ORDER BY columns** -> if the primary key is wrong, deduplication will not work properly.
3. **Expecting deduplicated results immediately** -> without a forced optimize, queries may still see duplicates.

### Best practices:

* For systems that cannot tolerate duplicates, run `OPTIMIZE TABLE FINAL` periodically after writes to ensure uniqueness.
* For real-time query applications with complex version requirements, consider **ReplacingMergeTree + Materialized View** to build a view of the latest version in real time.
* When designing the `Primary Key`, include only the columns that can uniquely identify one logical record. Do not put `version` into `ORDER BY`.

## Performance impact of ReplacingMergeTree

* Write performance is similar to regular `MergeTree` because deduplication is delayed and does not affect ingestion throughput.
* Background merge operations do extra deduplication work, so merge load is slightly higher, but query performance usually improves because fewer rows need to be scanned after deduplication.
* Once deduplication is done, storage usage can drop significantly, depending on how many duplicates exist.

## Closing thoughts

`ReplacingMergeTree` is a lightweight way to deduplicate data without requiring complex indexes or extra application logic. It is especially useful for **stream deduplication**, **duplicate-safe batch imports**, and **versioned data**.
That said, understanding **when deduplication happens** and **how to design the `Primary Key`** is the key to using this engine correctly.

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
