---
title: "ClickHouse Series: VersionedCollapsingMergeTree and Data Version Control"
published: 2025-08-14
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: ["ClickHouse", "Database", "Ironman"]
category: 'software development'
draft: false
lang: 'en'
---

When dealing with real-time event streaming or rapidly changing datasets, the simple insert/delete marker model of CollapsingMergeTree is often not enough for more complex data state and version management needs. For this, ClickHouse provides the more advanced **VersionedCollapsingMergeTree** storage engine, which uses both `sign` and `version` to implement stronger deduplication and version-control behavior.

## What Is VersionedCollapsingMergeTree?

VersionedCollapsingMergeTree is a variation of CollapsingMergeTree that adds a version column.
It identifies data uniqueness based on the Primary Key, uses `sign` for soft deletion, and relies on `version` to keep the latest version of a record.

### Key Features:

* `sign` column: marks insert (`1`) or delete (`-1`).
* `version` column: marks the version number of each record, and the system keeps the largest version.
* Under the same Primary Key, if `sign` values are opposite and the `version` is the same, the rows are collapsed away.
* If `version` values differ, the row with the largest version is kept.

## Syntax and Example

### Create a VersionedCollapsingMergeTree Table:

```sql
CREATE TABLE user_profiles
(
    user_id UInt64,
    name String,
    version UInt64,
    sign Int8
) ENGINE = VersionedCollapsingMergeTree(sign, version)
ORDER BY user_id;
```

### Insert Data:

```sql
-- Initial inserted record
INSERT INTO user_profiles VALUES (1, 'Alice', 1, 1);
-- Updated version
INSERT INTO user_profiles VALUES (1, 'Alice_updated', 2, 1);
-- Delete record (for version = 2)
INSERT INTO user_profiles VALUES (1, 'Alice_updated', 2, -1);
```

### Query Result (Before Merge):

| user\_id | name           | version | sign |
| -------- | -------------- | ------- | ---- |
| 1        | Alice          | 1       | 1    |
| 1        | Alice\_updated | 2       | 1    |
| 1        | Alice\_updated | 2       | -1   |

After a background Merge (or `OPTIMIZE FINAL`):

* The data for `version = 2` will be canceled out.
* The data for `version = 1` remains because it has no corresponding `-1` record.

## Differences from ReplacingMergeTree / CollapsingMergeTree

| Feature                              | CollapsingMergeTree                | ReplacingMergeTree                         | VersionedCollapsingMergeTree                               |
| ------------------------------------ | ---------------------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| Soft delete support                  | `sign` cancellation                | No soft delete support (can only overwrite by version) | `sign` cancellation                                         |
| Version control                      | No built-in version concept        | Uses version to keep the latest version    | `version` decides which latest row remains, combined with `sign` for deduplication |
| When deduplication happens           | During Merge, usually paired with `FINAL` | During Merge, usually paired with `FINAL` | During Merge, usually paired with `FINAL`                  |
| Typical use cases                    | Simple insert/delete marker scenarios | Rewrite/overwrite scenarios that keep the latest record | Complex rewrite, delete, and version-control needs, such as event rollback or data correction |

## Use Cases

| Use Case                               | Description                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------- |
| **Data Versioning**                    | Keep the latest version under the same Primary Key, while allowing rewrites and deletes to control state |
| **Real-Time Stream Deduplication and State Management** | Handle event replay and corrections in Kafka or message queues so that only one valid record exists per key |
| **Data Correction**                    | Better suited than plain CollapsingMergeTree when rewrites and deletes depend on more complex version logic |
| **IoT or Real-Time Status Updates**    | A device such as a `sensor_id` keeps updating, and you need to keep only the latest state while handling deletes and corrections correctly |

## Query Notes

* Deduplication and version selection happen during the background Merge phase.
* To guarantee consistency, query the final result with `FINAL`:

  ```sql
  SELECT * FROM user_profiles FINAL;
  ```
* If the dataset is large, avoid frequent full-table `FINAL` queries. Instead:

  * Narrow the query scope by partition
  * Run `OPTIMIZE TABLE ... FINAL` periodically to keep the data state stable

## Example

Suppose you are building a user behavior tracking platform and need to backfill bad events while also being able to delete corrected data properly:

1. **User behavior event stream table design**:

   ```sql
   CREATE TABLE user_events
   (
       user_id UInt64,
       event_type String,
       event_time DateTime,
       version UInt64,
       sign Int8
   ) ENGINE = VersionedCollapsingMergeTree(sign, version)
   ORDER BY (user_id, event_time);
   ```

2. **Write behavior events and correction records**:

   ```sql
   INSERT INTO user_events VALUES (1001, 'click', '2025-08-01 10:00:00', 1, 1);
   INSERT INTO user_events VALUES (1001, 'click', '2025-08-01 10:00:00', 2, 1); -- corrected rewrite
   INSERT INTO user_events VALUES (1001, 'click', '2025-08-01 10:00:00', 2, -1); -- cancel the bad correction
   ```

3. **Query the final state**:

   ```sql
   SELECT * FROM user_events FINAL;
   ```

## Best Practices

| Best Practice                                           | Description                                                                 |
| ------------------------------------------------------- | --------------------------------------------------------------------------- |
| Design the Primary Key so it uniquely identifies one logical record | Avoid overly fragmented key combinations and make sure deduplication and version pruning happen correctly |
| Make `version` monotonic and aligned with change logic  | Using a timestamp or version number that always increases helps keep the latest record correctly |
| Keep the `sign` and `version` logic clear and consistent | If rewrite and delete markers are inconsistent, Merge will not prune data correctly |
| Combine with a Partition Key to reduce Merge scope      | On large datasets, partitions shrink the impact of deduplication and version selection, improving query and Merge efficiency |
| Avoid full-table `FINAL` when possible; use partition-level queries or operational merges instead | On large datasets, full-table `FINAL` is expensive, so pair it with scheduled `Optimize FINAL` jobs |

## Conclusion

VersionedCollapsingMergeTree is a powerful engine in ClickHouse for managing data state and handling complex deduplication and rewrite scenarios. It combines the cancellation logic of CollapsingMergeTree with the version-control capability of ReplacingMergeTree, making it a strong fit for workloads where data changes frequently and version consistency matters. That said, you need to pay close attention to the consistency of the Primary Key, `sign`, and `version` design if you want to get the best performance out of it.

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
18. [ClickHouse Series: How to Improve Query Performance with system.query_log and EXPLAIN](https://blog.vicwen.app/posts/clickhouse-query-log-explain/)
19. [ClickHouse Series: Advanced Query Acceleration with Projections](https://blog.vicwen.app/posts/clickhouse-projections-optimization/)
20. [ClickHouse Series: Sampling Queries and the Principles Behind Statistical Techniques](https://blog.vicwen.app/posts/clickhouse-sampling-statistics/)
21. [ClickHouse Series: TTL Data Cleanup and Storage Cost Optimization](https://blog.vicwen.app/posts/clickhouse-ttl-storage-management/)
22. [ClickHouse Series: Storage Policies and Disk Tiering Strategy](https://blog.vicwen.app/posts/clickhouse-storage-policies/)
23. [ClickHouse Series: Table Design and Storage Optimization Details](https://blog.vicwen.app/posts/clickhouse-schemas-storage-improvement/)
24. [ClickHouse Series: Building Visual Monitoring with Grafana](https://blog.vicwen.app/posts/clickhouse-grafana-dashboard/)
25. [ClickHouse Series: Query Optimization Case Studies](https://blog.vicwen.app/posts/clickhouse-select-optimization/)
26. [ClickHouse Series: Integrating with BI Tools (Power BI)](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
27. [ClickHouse Series: Comparing ClickHouse Cloud and Self-Hosted Deployments](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
28. [ClickHouse Series: Database Security and RBAC Implementation](https://blog.vicwen.app/posts/clickhouse-security-rbac/)
29. [ClickHouse Series: Deploying a Distributed Architecture on Kubernetes](https://blog.vicwen.app/posts/clickhouse-operator-kubernates/)
30. [ClickHouse Series: Six Core MergeTree Mechanisms Through the Source Code](https://blog.vicwen.app/posts/clickhouse-mergetree-sourcecode-introduction/)
