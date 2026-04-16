---
title: "ClickHouse Series: How Primary Keys, Sorting Keys, and Granule Indexes Work"
published: 2025-08-12
description: ""
image: "https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress"
tags: [ClickHouse, Database, Ironman]
category: "software development"
draft: false
lang: "en"
---

In ClickHouse's query acceleration mechanism, in addition to Partition Pruning for coarse filtering, the other key mechanism for fine-grained scanning is the **Primary Key**, **Sorting Key**, and **Granule index**.

## What is a Primary Key?

In ClickHouse, the Primary Key is different from the "unique constraint" in traditional OLTP databases. It **does not guarantee uniqueness and does not automatically build an index tree such as a B-Tree**.
The ClickHouse Primary Key determines the physical ordering of data on disk and serves as the main indexing basis MergeTree uses when searching data.

### Characteristics:

* It determines the sorting logic of the data and serves as the basis for block filtering during queries.
* It complements the Partition Key: Partition handles coarse block pruning, while Primary Key determines sorting and positioning inside each block.
* It can consist of one or more columns, specified by the `ORDER BY` clause.

### Example:

```sql
CREATE TABLE orders
(
    order_date Date,
    user_id UInt64,
    order_id UInt64,
    amount Float64
) ENGINE = MergeTree
PARTITION BY toYYYYMM(order_date)
ORDER BY (user_id, order_date);
```

Here the Primary Key is `(user_id, order_date)`, and the data is written to disk in that order.

## What is a Sorting Key?

* **Sorting Key = the set of columns specified by the `ORDER BY` clause.**
* In ClickHouse, the Sorting Key and the Primary Key are the same thing, just named differently, and some docs use the terms interchangeably.
* The Sorting Key determines the physical ordering of data inside a Data Part and affects query pruning efficiency.

### Summary:

| Name | Description |
| ----------- | ---------------------------------- |
| Primary Key | Sorting index (Clustered Index), the actual basis for data ordering on disk |
| Sorting Key | Synonymous with Primary Key, but emphasizes the sorting logic |

## What is a Granule index?

A Granule is the smallest data unit ClickHouse can prune during a query.
A Granule contains thousands of rows (8192 rows by default), and the system stores the minimum and maximum Sorting Key values for that range as a min-max index.

### Query flow for Granules:

1. During a query, the WHERE clause is matched against the Granule min-max range.
2. If the condition is outside that Granule's range, the Granule is skipped.
3. This skipping is called **Primary Key range pruning**.

### Storage structure:

* Granule ≈ 8192 rows by default, but it is configurable
* One Data Part contains multiple Granules
* The Primary Key index is a sparse index stored at Granule granularity

## Example of Primary Key range pruning

```sql
SELECT * FROM orders WHERE user_id = 123456 AND order_date >= '2025-08-01';
```

1. First, ClickHouse decides which partitions should be read using Partition Pruning.
2. Inside the matching partition, it compares the Granule ranges using the Primary Key index:
   * Granule 1: `user_id = 123455 ~ 123455` -> skip
   * Granule 2: `user_id = 123456 ~ 123456` -> read
   * Granule 3: `user_id = 123457 ~ 123458` -> skip

This pruning step is the key reason ClickHouse can scan only a tiny amount of data even at TB scale.

## How is a Primary Key different from a Secondary Index?

| Comparison item | Primary Key (range index) | Secondary Index (Data Skipping Index) |
| ---- | ------------------------------ | ----------------------------------------- |
| How it works | Data is sorted on write, and queries prune ranges through the Granule index | Queries decide whether to read based on the column value range (`min-max` / bloom filter) |
| Query efficiency | Excellent when the query condition matches the sorted columns | Can filter non-sorted columns, but is not as efficient as the Primary Key |
| How it is created | Set with `ORDER BY`, tightly coupled to MergeTree | Must be created separately (`ALTER TABLE ADD INDEX...`) |
| Suitable queries | Range queries, sequence queries, and queries that follow the sorting logic | Queries on high-cardinality columns such as specific tags or keywords |

## Primary Key design strategy

| Design strategy | Suitable scenario |
| --------------------------------- | -------------------------------------------- |
| **Put the most common range condition first** | If `user_id` or `device_id` is commonly used in WHERE clauses, put it at the front of the sorting key |
| **Sort from high selectivity to low selectivity** | For example, `user_id -> event_date`, so the Granule range becomes more focused and pruning more accurate |
| **Avoid using highly variable but rarely queried columns as sorting keys** | UUIDs and random hashes do not help pruning and only increase merge cost |
| **Design Partition and Sorting Key together** | Partition handles coarse pruning, Primary Key handles fine pruning, and queries scan only a very small range of data |

## How sparse primary indexes work

ClickHouse's Primary Key is not a full index like a B-Tree in traditional databases. Instead, it is designed as a **sparse index**, using Granules to filter large datasets quickly.

### How it works:

1. **Each Granule stores only the first row's Primary Key value**: for example, with the default Granule size of 8192 rows, the index only records the first row's primary key value in each Granule.
2. **The sparse index is tiny and can fit entirely in memory**, so even if the dataset contains hundreds of billions of rows, it still uses very little memory.
3. **Each MergeTree Data Part has its own Primary Index**, and the query compares them separately for the best pruning effect.
4. **During a query, ClickHouse compares the `WHERE` clause with the sparse Primary Index to match Granule ranges**:

   * Granules outside the condition range are skipped immediately.
   * Only Granules inside the range are read for further filtering.

### Query acceleration effect:

* This sparse index structure lets the query scan only the necessary Granules, greatly reducing I/O and memory usage. The latency reduction is especially noticeable at TB scale.

### How do you check whether the Primary Index is working?

ClickHouse provides several useful commands to inspect index behavior:

#### 1. View the index contents: `mergeTreeIndex` table function

```sql
SELECT * FROM mergeTreeIndex('your_database.your_table', 'primary_key') LIMIT 10;
```

This helps you see the Primary Key value of the first row in each Granule and understand the index structure.

#### 2. Use `EXPLAIN` to confirm index pruning:

```sql
EXPLAIN PLAN SELECT * FROM orders WHERE user_id = 123456;
```

* If the WHERE clause matches the Primary Key well, the query plan will show a Granule pruning step.
* If the condition does not match, such as querying a non-sorting column, the index cannot be used for pruning.

#### 3. Inspect pruning stats with `system.parts`:

```sql
SELECT partition, active, rows, bytes_on_disk
FROM system.parts
WHERE table = 'orders' AND active;
```

## Granule granularity and performance trade-offs

### Adjusting Granule size:

* Through `index_granularity`:

  ```sql
  CREATE TABLE t (...) ENGINE = MergeTree() ORDER BY ... SETTINGS index_granularity = 4096;
  ```
* Smaller granularity gives better pruning but increases index size and CPU overhead during queries.
* Larger granularity keeps less index data and lower CPU cost, but pruning becomes less precise and I/O cost rises.

### Recommendation:

* For most cases, the default 8192 is good enough.
* If the query condition matches the sorting key very precisely and the data volume is large, consider lowering it to 4096 or 2048.
* If your workload is mostly full table scans or heavy aggregation, increasing granularity may improve throughput.

## Best practices

| Best practice | Description |
| ------------------------------- | ----------------------------------------------------------- |
| Keep the Primary Key to 1-3 columns when possible | Too many columns increase sorting cost and merge overhead, while reducing pruning effectiveness |
| Pruning efficiency depends on how well the query matches the sorting key | If the WHERE clause matches the first sorting column, pruning works best |
| Avoid excessive tweaking of `index_granularity` | Unless you have a special need, do not change it drastically; the default 8192 is usually the best balance |
| Combine Partition design with layered pruning | Partition handles coarse pruning and Primary Key handles fine pruning, enabling second-level queries even on TB-scale data |
| Use a Secondary Index to improve non-sorting-column queries | If you need to query columns outside the Primary Key, such as tags, a Bloom Filter Index can help |

## Closing thoughts

Primary Key and Granule indexes are the core technologies that allow ClickHouse to achieve millisecond-level queries on massive datasets. With a sensible Sorting Key design, appropriate granularity tuning, and Partition Pruning, you can reduce scanned data to the minimum and dramatically improve query performance.

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
