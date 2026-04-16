---
title: "ClickHouse Series: Advanced Query Acceleration with Projections"
published: 2025-08-22
description: ""
image: "https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress"
tags: [ClickHouse, Database, Ironman]
category: "software development"
draft: false
lang: "en"
---

When handling large-scale aggregate queries, ClickHouse has more than just Partition Pruning and Data Skipping Indexes to speed things up (~~if you forgot them, go review them again~~). There is another very powerful query optimization weapon: **Projections**.

Projections can pre-sort, pre-aggregate, or reorganize data structures so that the query execution path becomes **shorter and faster**.

## What Is a Projection?

A Projection is an internal materialized structure stored inside table parts. It pre-builds sorted or aggregated results for specific query patterns.

| Feature               | Description                                               |
| --------------------- | --------------------------------------------------------- |
| Part of the table     | Projection data lives together with the table in the same data part. |
| Automatically used at query time | You do not need to change the query syntax. ClickHouse automatically chooses the projection with the smallest scan cost. |
| Multiple projections supported | You can define different projections for different query needs. |


## Advantages of Projections

1. **Reduce the amount of data scanned** -> read only the projection instead of scanning the entire table.
2. **Speed up aggregation** -> use precomputed aggregation results directly at query time.
3. **Lower I/O load** -> disk reads drop significantly, which reduces query latency.

## Example

```sql
CREATE TABLE user_events
(
    EventDate Date,
    UserID UInt64,
    Action String,
    Version UInt32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(EventDate)
ORDER BY (UserID, EventDate)
SETTINGS index_granularity = 8192
AS
SELECT * FROM source_table;

ALTER TABLE user_events
ADD PROJECTION daily_user_action_counts
(
    SELECT
        EventDate,
        Action,
        count() AS ActionCount
    GROUP BY
        EventDate,
        Action
);
```

After running `OPTIMIZE TABLE user_events FINAL`, ClickHouse will write the projection data into the table parts in the background.

## Projection Hits Automatically at Query Time

As long as the query matches the projection structure, ClickHouse will automatically use the projection to speed up the query:

```sql
SELECT EventDate, Action, count() 
FROM user_events 
WHERE EventDate = '2025-08-10' 
GROUP BY EventDate, Action;
```

You can use `EXPLAIN PLAN` to see that the query is using the projection:

```sql
EXPLAIN PLAN SELECT EventDate, Action, count() FROM user_events WHERE EventDate = '2025-08-10' GROUP BY EventDate, Action;

Projection: daily_user_action_counts
ReadFromMergeTree (using projection)
```

## Practice: A Case Where Projections Speed Things Up by 10x

Suppose `user_events` has 1 billion rows, and you run this query:

```sql
SELECT EventDate, Action, count() 
FROM user_events 
WHERE EventDate >= '2025-08-01' 
GROUP BY EventDate, Action;
```

* **Without a projection**: the query must scan all 1 billion rows and takes 20 seconds.
* **With a projection**: only 10 million projection rows are scanned, and the query takes just **2 seconds**.

This kind of workload is especially suitable for BI reports and high-frequency aggregation queries on dashboards.

## Notes and Limitations

| Limitation                            | Description                                               |
| ------------------------------------ | --------------------------------------------------------- |
| Projection design must be planned in advance | Once a projection is defined, its structure cannot be modified. |
| INSERT writes to projections too       | Writes will incur some extra CPU overhead.                |
| `OPTIMIZE TABLE` must merge projection data | After projection data is written, you need to run Optimize to merge the projection parts. |

## Conclusion

Projections are one of ClickHouse's core tools for accelerating large-scale aggregation queries. With a well-designed projection, you can instantly improve query performance by several times.

For reporting and real-time dashboard scenarios, using Projections wisely can significantly reduce system load and query latency, making them a key weapon in big data analytics.


### ClickHouse Series Continues:

1. [ClickHouse Series: What Is ClickHouse? How It Differs from Traditional OLAP/OLTP Databases](https://blog.vicwen.app/posts/what-is-clickhouse/)
2. [ClickHouse Series: Why ClickHouse Uses Column-Based Storage? Core Differences Between Row-Based and Column-Based Storage](https://blog.vicwen.app/posts/clickhouse-column-row-based-storage/)
3. [ClickHouse Series: ClickHouse Storage Engine - MergeTree](https://blog.vicwen.app/posts/clickhouse-mergetree-engine)
4. [ClickHouse Series: How Compression and Data Skipping Indexes Dramatically Speed Up Queries](https://blog.vicwen.app/posts/clickhouse-compression-skipping-index/)
5. [ClickHouse Series: ReplacingMergeTree and Data Deduplication](https://blog.vicwen.app/posts/clickhouse-replacingmergetree-deduplication/)
6. [ClickHouse Series: Practical Uses of SummingMergeTree for Aggregation](https://blog.vicwen.app/posts/clickhouse-summingmergetree-aggregation/)
7. [ClickHouse Series: Real-Time Aggregation with Materialized Views](https://blog.vicwen.app/posts/clickhouse-materialized-view/)
8. [ClickHouse Series: Partition Strategy and Partition Pruning Explained](https://blog.vicwen.app/posts/clickhouse-partition-pruning/)
9. [ClickHouse Series: Primary Key, Sorting Key, and How Granule Indexes Work](https://blog.vicwen.app/posts/clickhouse-primary-sorting-key/)
10. [ClickHouse Series: Best Practices for CollapsingMergeTree and Logical Deletion](https://blog.vicwen.app/posts/clickhouse-collapsingmergetree/)
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
21. [ClickHouse Series: TTL-Based Data Cleanup and Storage Cost Optimization](https://blog.vicwen.app/posts/clickhouse-ttl-storage-management/)
22. [ClickHouse Series: Storage Policies and Tiered Disk Resource Management](https://blog.vicwen.app/posts/clickhouse-storage-policies/)
23. [ClickHouse Series: Table Design and Storage Optimization Details](https://blog.vicwen.app/posts/clickhouse-schemas-storage-improvement/)
24. [ClickHouse Series: Building Visual Monitoring with Grafana](https://blog.vicwen.app/posts/clickhouse-grafana-dashboard/)
25. [ClickHouse Series: Query Optimization Case Studies](https://blog.vicwen.app/posts/clickhouse-select-optimization/)
26. [ClickHouse Series: Integrating with BI Tools (Power BI)](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
27. [ClickHouse Series: ClickHouse Cloud vs Self-Hosted Deployment](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
28. [ClickHouse Series: Database Security and Access Control (RBAC)](https://blog.vicwen.app/posts/clickhouse-security-rbac/)
29. [ClickHouse Series: Deploying a Distributed Architecture on Kubernetes](https://blog.vicwen.app/posts/clickhouse-operator-kubernates/)
30. [ClickHouse Series: Six Core MergeTree Mechanisms Seen from the Source Code](https://blog.vicwen.app/posts/clickhouse-mergetree-sourcecode-introduction/)
