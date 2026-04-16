---
title: "ClickHouse Series: Query Optimization Case Studies"
published: 2025-08-28
description: ""
image: "https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress"
tags: ["ClickHouse", "Database", "Ironman"]
category: "software development"
draft: false
lang: "en"
---

In the previous articles, we already introduced ClickHouse's basic architecture, the MergeTree storage engine, and various indexing and compression mechanisms. These features make ClickHouse a highly performant OLAP database, especially for large-scale queries.

However, in real projects, performance is not guaranteed. Even with the same table and the same data, a poorly designed query can run more than 100 times slower.

## Why Do We Need Query Optimization?

ClickHouse is very good at handling billions of rows, but that does not mean we can query it blindly. As data grows from **1 million -> 10 million -> 100 million**, poor design can make query speed degrade from milliseconds to several seconds or even tens of seconds, directly hurting the user experience.

For example:

* Dashboards fail to refresh in real time, causing delayed decisions
* API responses take more than a few seconds, making the front end feel sluggish
* Backend engineers and data scientists cannot finish analysis in a reasonable amount of time

Therefore, **query optimization is not just about being fast. It is also about system stability and scalability**.

## OFFSET Pagination Performs Poorly

In many systems, the most common requirement is pagination. Suppose we have an `events` table that records user actions:

```sql
SELECT * FROM events 
ORDER BY created_at DESC 
LIMIT 50 OFFSET 1000000;
```

This query looks normal, but performance drops sharply as OFFSET grows. ClickHouse has to scan and discard the first million rows before it can return rows 1,000,001 through 1,000,050.

### Optimization: Keyset Pagination

Switch to pagination based on the primary key or sorting column:

```sql
SELECT * FROM events 
WHERE created_at < '2025-01-01 00:00:00'
ORDER BY created_at DESC
LIMIT 50;
```

This approach queries directly from a given point in time and does not need to discard earlier rows, so performance improves significantly.

* **Before optimization**: several seconds to tens of seconds
* **After optimization**: hundreds of milliseconds or even faster

This method is especially effective for time-series data, and it matches ClickHouse's design philosophy: **scan as little data as possible instead of scanning everything and filtering afterward**.

## WHERE Conditions Do Not Use an Index

Another common problem is that the query condition does not hit an index. Suppose we want to query a user's records from the last 7 days:

```sql
SELECT COUNT(*) 
FROM logs 
WHERE user_id = 123 
AND created_at >= today() - 7;
```

If the table's sorting key is not `(user_id, created_at)`, this query will scan the full table and perform very poorly.

### Optimization: Primary Key + Partition

When designing a table, we should think about query patterns and make the common filter conditions part of the sorting key or partition:

```sql
CREATE TABLE logs
(
    user_id UInt64,
    created_at DateTime,
    event_type String,
    ...
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (user_id, created_at);
```

With this design, when we query a specific `user_id` within a time range, ClickHouse automatically performs **Partition Pruning** and scans only the required data.

* **Before optimization**: scans hundreds of millions of rows
* **After optimization**: scans only a few million rows, with speed improving by more than 10x

## Duplicate Data Slows Down Aggregation

In practice, we often run into cases where batch imports introduce duplicate rows. For example, some ETL jobs import a full dataset every day, but the data includes repeated records.

The original query has to deduplicate with `GROUP BY`, which is very inefficient on hundreds of millions of rows.

### Optimization 1: Deduplicate with ReplacingMergeTree

Use `ReplacingMergeTree` to automatically remove duplicates during the merge phase:

```sql
CREATE TABLE events
(
    id UInt64,
    user_id UInt64,
    event_type String,
    version UInt32
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (id);
```

With this setup, the query no longer needs extra deduplication, and performance improves significantly. I personally ran into this during my internship, QQ, and ended up rebuilding the table and moving the data into a new `ReplacingMergeTree` table.

### Optimization 2: Pre-Aggregation with Materialized Views

Another approach is to create a **Materialized View** and store pre-aggregated results in a new table:

```sql
CREATE MATERIALIZED VIEW events_mv 
ENGINE = SummingMergeTree()
ORDER BY (user_id, event_type)
AS
SELECT user_id, event_type, count() AS cnt
FROM events
GROUP BY user_id, event_type;
```

At query time, you only need to run SELECT against `events_mv`, and the performance is nearly instant.

## JOIN Performance Is Not Great

ClickHouse JOINs are not as flexible as those in **traditional relational databases**, and performance can be very poor if you are not careful.

Suppose we want to join the `events` table with the `users` table:

```sql
SELECT e.*, u.name 
FROM events e
JOIN users u ON e.user_id = u.id;
```

If `users` is a large table, JOIN performance will drop quickly.

### Optimization: Speed It Up with Dictionary

If `users` is a small table, you can convert it into a **Dictionary** and keep it in memory for query use:

```sql
CREATE DICTIONARY users_dict
(
    id UInt64,
    name String
)
PRIMARY KEY id
SOURCE(CLICKHOUSE(TABLE users))
LAYOUT(HASHED());
```

Then you can rewrite the query as:

```sql
SELECT e.*, dictGet('users_dict', 'name', toUInt64(e.user_id)) AS user_name
FROM events e;
```

This is basically turning `users` into a very efficient cache and avoiding a large-table JOIN.

* **Before optimization**: JOIN queries take several seconds or even tens of seconds
* **After optimization**: queries take only hundreds of milliseconds

> If you want to learn more about Dictionary, refer to the [official documentation](https://clickhouse.com/docs/dictionary#:~:text=A%20dictionary%20in%20ClickHouse%20provides%20an%20in-memory%20key-value,external%20sources%2C%20optimizing%20for%20super-low%20latency%20lookup%20queries.). A Dictionary is a special type designed to act as a cache for small tables, letting you avoid joining large tables on every high-frequency query and instead speed things up with cached key-value mappings.

## Summary

From these cases, we can see that ClickHouse query optimization generally follows these principles:

1. **Avoid OFFSET and use keyset pagination instead**
2. **Design good sorting keys and partitions** so queries can hit indexes
3. **Use MergeTree variants** such as Replacing and Summing to handle deduplication and aggregation
4. **Make good use of Materialized Views** to precompute results and avoid repeated work
5. **Minimize JOINs**: small-table joins can be replaced with Dictionaries, while large-table joins should be used carefully
6. **Reduce the amount of data that needs to be scanned** instead of filtering after the fact

With query optimization, we can reduce queries that originally took seconds or even tens of seconds down to milliseconds. That matters a lot for real-time analytics and online system performance.

I hope these examples help everyone use ClickHouse more effectively in practice! 🚀

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
