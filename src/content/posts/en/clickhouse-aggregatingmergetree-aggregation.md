---
title: "ClickHouse Series: Advanced Real-Time Metrics with AggregatingMergeTree"
published: 2025-08-15
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: ["ClickHouse", "Database", "Ironman", "Distributed"]
category: 'software development'
draft: false
lang: 'en'
---

In large-scale analytics systems, as both data volume and query complexity grow, relying only on `SELECT` aggregation queries such as `SUM`, `COUNT`, and `AVG` is no longer enough to deliver real-time responses. For high-efficiency aggregation workloads, ClickHouse provides the **AggregatingMergeTree** storage engine, which uses pre-aggregation and compressed aggregation states (`AggregateFunction` types) to significantly reduce query latency.

### What Is AggregatingMergeTree?

AggregatingMergeTree is the aggregation-focused storage engine in the ClickHouse MergeTree family. Its characteristics are:

* Data is stored as **`AggregateFunction` types** when written, meaning precomputed aggregation states.
* During the Merge phase, **state merging** is performed to merge aggregated results that share the same Primary Key.
* At query time, **state finalization** restores those states into final numeric results.

This design is especially suitable for high-ingest and aggregation-heavy workloads such as website traffic analytics, real-time KPI dashboards, and IoT device data aggregation.

### Differences from SummingMergeTree

| Feature                     | SummingMergeTree                   | AggregatingMergeTree                                     |
| --------------------------- | ---------------------------------- | -------------------------------------------------------- |
| Supported aggregation funcs | Supports only `SUM`                | Supports all `AggregateFunction`s such as `SUM`, `AVG`, `COUNT`, `MIN`, and `MAX` |
| Storage type                | Regular numeric columns (`UInt`, `Float`) | `AggregateFunction` types that store aggregation states |
| Aggregates during Merge?    | Sums numeric columns with the same Primary Key | Merges aggregation states for rows with the same Primary Key |
| Special query handling?     | No, a normal `SELECT` is enough    | Yes, queries must restore states with functions like `sumMerge(col)` or `avgMerge(col)` |
| Typical use cases           | Counter-style metrics such as PV, clicks, and revenue totals | Complex aggregations such as averages, distinct counts, quantiles, and standard deviation |

### Syntax and Basic Example

#### Create the Source Table, AggregatingMergeTree Table, and MV Table:

```sql
-- Source Table
CREATE TABLE visits (
    StartDate DateTime64 NOT NULL,
    CounterID UInt64,
    Sign Nullable(Int32),
    UserID Nullable(Int32)
) ENGINE = MergeTree ORDER BY (StartDate, CounterID);

-- AggregatingMergeTree Table
CREATE TABLE agg_visits (
    StartDate DateTime64 NOT NULL,
    CounterID UInt64,
    Visits AggregateFunction(sum, Nullable(Int32)),
    Users AggregateFunction(uniq, Nullable(Int32))
)
ENGINE = AggregatingMergeTree()
ORDER BY (StartDate, CounterID);

-- Materialized View Table
CREATE MATERIALIZED VIEW visits_mv TO agg_visits
AS SELECT
    StartDate,
    CounterID,
    sumState(Sign) AS Visits,
    uniqState(UserID) AS Users
FROM visits
GROUP BY StartDate, CounterID;
```

#### Insert Data (Written as Aggregation States):

```sql
INSERT INTO visits (StartDate, CounterID, Sign, UserID)
 VALUES (1667446031000, 1, 3, 4), (1667446031000, 1, 6, 3);
```

The data is written to both the `visits` and `agg_visits` tables.

#### Query Aggregated Results (States Must Be Restored with Merge Functions):

```sql
SELECT
    StartDate,
    sumMerge(Visits) AS Visits,
    uniqMerge(Users) AS Users
FROM agg_visits
GROUP BY StartDate
ORDER BY StartDate;
```

```
┌───────────────StartDate─┬─Visits─┬─Users─┐
│ 2022-11-03 03:27:11.000 │      9 │     2 │
└─────────────────────────┴────────┴───────┘
```

### Workflow

1. **Write data as `AggregateFunction` states**

   * Use functions such as `sumState()`, `avgState()`, and `uniqExactState()` to write data as aggregation states.
2. **Background Merge (State Merging)**

   * When rows with the same Primary Key are merged, ClickHouse merges the `AggregateFunction` states.
   * This happens in background Merge operations and does not block write throughput.
3. **Restore aggregation results at query time (State Finalization)**

   * Query-time functions such as `sumMerge()`, `avgMerge()`, and `uniqExactMerge()` convert the stored states back into final values.

### Use Cases

| Use Case                                     | Description                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| **Real-Time Traffic and User Metrics (PV / UV Reports)** | Large volumes of user events are aggregated into daily page views and unique visitors (`uniqExact`) |
| **IoT Device Aggregation and Real-Time Status Metrics** | Aggregate sensor data in real time for averages, minima, maxima, and quantiles |
| **Deduplicated Event Streams and Complex KPI Computation** | Suitable for advanced metrics such as multi-KPI dashboards and average session duration |
| **Pre-Aggregation at the Data Layer**        | Precompute frequently queried aggregates to reduce CPU and I/O during reads |

### Improvement: Delay Aggregation Until the Merge Phase

To move aggregation cost from `INSERT` time to the Merge phase, you can do this:

```sql
SET optimize_on_insert = 0;

CREATE MATERIALIZED VIEW visits_mv TO agg_visits
AS SELECT
    StartDate,
    CounterID,
    initializeAggregation('sum', Sign) AS Visits,
    initializeAggregation('uniqExact', UserID) AS Users
FROM visits;
```

This works through two key steps:

* `initializeAggregation()`: turns raw values into aggregation states without needing `GROUP BY`.
* `optimize_on_insert = 0`: disables automatic pre-aggregation during insert, pushing aggregation to later Merge operations.

Benefits:
1. **Reduce compute pressure during `INSERT` and maximize write throughput**
    * In the traditional Materialized View pre-aggregation model, every `INSERT` has to run a `GROUP BY`, which adds immediate CPU and memory pressure and can slow ingestion during peaks.
    * With `initializeAggregation` + `optimize_on_insert = 0`, every row is written directly as an aggregation state, without computing the final aggregate up front. That turns inserts into a lower-cost operation: mostly writing files plus creating states.
    * This is especially suitable for high-ingest scenarios with tens or hundreds of thousands of rows per second, such as IoT, clickstreams, and user behavior tracking.
2. **Smooth aggregation cost out into background Merge operations**
    * Traditional pre-aggregation pushes all aggregation cost into `INSERT`, which can spike resource usage during write bursts.
    * The `initializeAggregation` pattern delays aggregation to the Merge stage, where ClickHouse can process it **in batches, automatically, and in a distributed way**. Background Merge can then adapt to system load and avoid immediate impact on online reads and writes, while also giving you more flexibility in Merge strategy such as TTL-based Merge or periodic `optimize_final`.

#### Why Must `initializeAggregation` Be Paired with `optimize_on_insert = 0`?

When you use `initializeAggregation()`, ClickHouse creates an unmerged aggregate state for each row. This lets every row keep its own independent aggregation state until MergeTree performs background merges, at which point rows with the same Primary Key are actually aggregated.

However, this behavior, which avoids `GROUP BY`-based pre-aggregation, does not work under the default setting (`optimize_on_insert = 1`) because ClickHouse will automatically optimize by aggregating identical keys before the data is written.

Only when you set `optimize_on_insert` to `0` will ClickHouse skip that insert-time pre-aggregation optimization, write the data into AggregatingMergeTree as-is, and delay the aggregation work to the Merge phase.

#### Effect

| Condition                                            | Behavior                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `initializeAggregation() + optimize_on_insert = 0`   | Every source row is written as an independent aggregation state, and queries depend on background Merge to get final results |
| `initializeAggregation() + optimize_on_insert = 1`   | ClickHouse automatically performs `GROUP BY` aggregation before writing   |
| Traditional `sumState() + Group By` pattern          | Data is already pre-aggregated at `INSERT` time                          |


### Best Practices

| Best Practice                                  | Description                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| Handle aggregation-state data with State / Merge functions | Write State values on insert, and restore them with Merge functions on `SELECT` |
| Primary Key design determines Merge granularity | `ORDER BY` should uniquely identify the aggregation dimensions, such as date and page, to avoid ineffective merging or overly wide Merge ranges |
| Combine with a Partition Key for data block management | Reduces Merge resource usage and improves query pruning                     |
| Use Materialized Views for real-time aggregation | Improves the timeliness and performance of moving raw data into AggregatingMergeTree |
| Run `OPTIMIZE FINAL` regularly                  | Ensures better consistency and performance by reducing the number of small data parts |

### When to Choose AggregatingMergeTree vs. SummingMergeTree

| Scenario                               | Recommended Engine Choice                  |
| -------------------------------------- | ------------------------------------------ |
| Simple counters such as PV and clicks  | SummingMergeTree                           |
| Distinct counts such as UV or deduped metrics | AggregatingMergeTree + `uniqExact`     |
| Advanced metrics such as averages and quantiles | AggregatingMergeTree                    |
| Scenarios with frequent rewrites and corrections | AggregatingMergeTree                   |

### Conclusion

Personally, I think AggregatingMergeTree is a powerful tool for workloads that combine high-ingest writes with complex aggregation. But internally, it is genuinely complicated XD, with a lot of moving parts. If you want to choose the right MergeTree engine, you really need a deeper understanding of the related concepts before you can optimize the system well.

By storing aggregation states in advance through `AggregateFunction`, and pairing that with MergeTree's merge mechanism and the real-time computation power of Materialized Views, you can push query performance down to the millisecond level. It is a strong fit for dashboards, traffic monitoring, and IoT data aggregation.

But you still need to pay close attention to **Primary Key and Partition design** if you want merging and query pruning to perform at their best.

### More Posts in This Series:

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
