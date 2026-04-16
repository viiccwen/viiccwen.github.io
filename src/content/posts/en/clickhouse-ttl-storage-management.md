---
title: "ClickHouse Series: TTL Data Cleanup and Storage Cost Optimization"
published: 2025-08-24
description: ""
image: "https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress"
tags: [ClickHouse, Database, Ironman]
category: "software development"
draft: false
lang: "en"
---

As the amount of data grows over time, how to eliminate manual labor and use automation to clean up expired data and control storage costs has become an aspect that cannot be ignored in the design of large-scale data systems. ClickHouse provides **TTL (Time To Live) data cleaning mechanism**, which not only automatically deletes expired data, but also moves data to cold storage (such as S3, HDD), effectively reducing storage costs.

## What is TTL?

TTL (Time To Live) refers to setting the "life cycle" of data. When the data reaches the specified conditions, ClickHouse will automatically clean (delete) or move the storage level (Move to Volume).

TTL can be applied to:

1. **Entire Row Data (Row TTL)** → Automatically delete expired data.
2. **Field data (Column TTL)** → Clean up the specified fields.
3. **Volume TTL** → Move data from SSD to different Volumes such as HDD/S3 to reduce storage costs.

## Example

### 1. Row TTL: Automatically delete expired data

```sql
CREATE TABLE events
(
    EventDate DateTime,
    UserID UInt64,
    Action String
) ENGINE = MergeTree
PARTITION BY toYYYYMM(EventDate)
ORDER BY (UserID, EventDate)
TTL EventDate + INTERVAL 7 DAY;
```

This will cause data to be automatically cleared after `EventDate` exceeds 7 days.

### 2. Column TTL: Clear the specified field when it expires

```sql
CREATE TABLE logs
(
    EventDate DateTime,
    UserID UInt64,
    Action String,
    TempField String TTL EventDate + INTERVAL 1 DAY
) ENGINE = MergeTree
ORDER BY UserID;
```

`TempField` field data will be cleared after 1 day, but row data will still be retained.

### 3. Volume TTL: Automatic tiered storage (Hot → Cold Storage)

```xml
// config.xml
<storage_configuration>
    <disks>
        <disk_ssd>
            <path>/var/lib/clickhouse/ssd/</path>
        </disk_ssd>
        <disk_hdd>
            <path>/var/lib/clickhouse/hdd/</path>
        </disk_hdd>
    </disks>
    <policies>
        <tiered_policy>
            <volumes>
                <hot>
                    <disk>disk_ssd</disk>
                </hot>
                <cold>
                    <disk>disk_hdd</disk>
                    <max_data_part_size_bytes>5000000000</max_data_part_size_bytes>
                </cold>
            </volumes>
        </tiered_policy>
    </policies>
</storage_configuration>
```

```sql
CREATE TABLE events_tiered
(
    EventDate DateTime,
    UserID UInt64,
    Action String
) ENGINE = MergeTree
ORDER BY (UserID, EventDate)
SETTINGS storage_policy = 'tiered_policy'
TTL EventDate + INTERVAL 7 DAY TO VOLUME 'cold';
```

*The data in the first 7 days will be placed on SSD (Hot)
* Data will be automatically moved to HDD (Cold) after 7 days

## TTL cleaning principle and execution timing

| Trigger timing | Description |
| ---------------------- | --------------------------------- |
| **Background Merge (Merge)** | TTL cleanup and Volume movement are processed together in the Merge phase. |
| **ALTER TABLE FREEZE** | Can be forced to trigger manually.                         |
| **Cleaning is non-immediate** | TTL is not an immediate deletion and depends on the frequency of background merging and resource conditions.        |

suggestion:

* Adjust **merge\_with\_ttl\_timeout** and **merge\_with\_recompression\_ttl\_timeout** settings to shorten the TTL trigger time.
* View **system.part\_log** to track which Data Parts have undergone TTL actions.

## Case

### Instant behavioral data is retained for 7 days

```sql
CREATE TABLE user_behavior
(
    EventDate DateTime,
    UserID UInt64,
    Action String
) ENGINE = MergeTree
ORDER BY (UserID, EventDate)
TTL EventDate + INTERVAL 7 DAY;
```

### The detailed log is moved to cold storage and the hot data of the past 3 days is retained.

```sql
CREATE TABLE logs_tiered
(
    EventDate DateTime,
    LogID UUID,
    Details String
) ENGINE = MergeTree
ORDER BY (LogID, EventDate)
SETTINGS storage_policy = 'tiered_policy'
TTL EventDate + INTERVAL 3 DAY TO VOLUME 'cold';
```

## Monitor and verify TTL execution

1. **Query the TTL status of data fragments:**

```sql
SELECT table, partition_id, min(min_ttl), min(max_ttl)
FROM system.parts
WHERE active = 1
GROUP BY table, partition_id;
```

2. **Forced cleaning (not recommended for frequent use):**

```sql
OPTIMIZE TABLE events FINAL;
```

3. **Tracking Part change records (`system.part_log`):**

```sql
SELECT * FROM system.part_log WHERE event_type = 'MergeParts' AND table = 'events';
```

## Conclusion

TTL is not only cleaning out expired data, but also an important tool for controlling ClickHouse storage resource tiering (SSD → HDD → S3). Properly designing a TTL strategy can help you achieve the best balance between performance and cost. (The boss will also love you very much)

### ClickHouse series continues to be updated:
1. [ClickHouse Series: What is ClickHouse? Differences from traditional OLAP/OLTP database](https://blog.vicwen.app/posts/what-is-clickhouse/)
2. [ClickHouse Series: Why does ClickHouse choose Column-based storage? Explain the core differences between Row-based and Column-based](https://blog.vicwen.app/posts/clickhouse-column-row-based-storage/)
3. [ClickHouse Series: ClickHouse Storage Engine - MergeTree](https://blog.vicwen.app/posts/clickhouse-mergetree-engine)
4. [ClickHouse Series: How compression technology and Data Skipping Indexes can greatly speed up queries](https://blog.vicwen.app/posts/clickhouse-compression-skipping-index/)
5. [ClickHouse Series: ReplacingMergeTree and data deduplication mechanism](https://blog.vicwen.app/posts/clickhouse-replacingmergetree-deduplication/)
6. [ClickHouse Series: Application scenarios of SummingMergeTree for data aggregation](https://blog.vicwen.app/posts/clickhouse-summingmergetree-aggregation/)
7. [ClickHouse Series: Materialized Views Instant Aggregation Query](https://blog.vicwen.app/posts/clickhouse-materialized-view/)
8. [ClickHouse Series: Analysis of Partition Strategy and Partition Pruning Principle](https://blog.vicwen.app/posts/clickhouse-partition-pruning/)
9. [ClickHouse Series: Primary Key, Sorting Key and Granule Index Operation Principle](https://blog.vicwen.app/posts/clickhouse-primary-sorting-key/)
10. [ClickHouse Series: Best Practices for CollapsingMergeTree and Logical Deletion](https://blog.vicwen.app/posts/clickhouse-collapsingmergetree/)
11. [ClickHouse Series: VersionedCollapsingMergeTree version control and data conflict resolution](https://blog.vicwen.app/posts/clickhouse-versioned-collapsingmergetree/)
12. [ClickHouse Series: Advanced Application of AggregatingMergeTree Real-time Indicator Statistics](https://blog.vicwen.app/posts/clickhouse-aggregatingmergetree/)
13. [ClickHouse Series: Distributed Table and Distributed Query Architecture](https://blog.vicwen.app/posts/clickhouse-distributed-table-architecture/)
14. [ClickHouse Series: Replicated Tables High Availability and Zero Downtime Upgrade Implementation](https://blog.vicwen.app/posts/clickhouse-replication-failover/)
15. [ClickHouse Series: Integrate with Kafka to create real-time Data Streaming Pipeline](https://blog.vicwen.app/posts/clickhouse-kafka-data-streaming-pipeline/)
16. [ClickHouse Series: Batch Import Best Practices (CSV, Parquet, Native Format)](https://blog.vicwen.app/posts/clickhouse-batch-import/)
17. [ClickHouse Series: ClickHouse integration with external data sources (PostgreSQL)](https://blog.vicwen.app/posts/clickhouse-external-data-integration/)
18. [ClickHouse Series: How to improve query optimization? system.query_log and EXPLAIN usage](https://blog.vicwen.app/posts/clickhouse-query-log-explain/)
19. [ClickHouse Series: Projections Advanced Query Acceleration Technology](https://blog.vicwen.app/posts/clickhouse-projections-optimization/)
20. [ClickHouse Series: Sampling Sampling Query and Statistical Technology Principles](https://blog.vicwen.app/posts/clickhouse-sampling-statistics/)
21. [ClickHouse Series: TTL data cleaning and storage cost optimization](https://blog.vicwen.app/posts/clickhouse-ttl-storage-management/)
22. [ClickHouse Series: Storage Policies and Disk Resource Tiering Strategies](https://blog.vicwen.app/posts/clickhouse-storage-policies/)
23. [ClickHouse Series: Table design and storage optimization details](https://blog.vicwen.app/posts/clickhouse-schemas-storage-improvement/)
24. [ClickHouse Series: ClickHouse Series: Integrate Grafana to create visual monitoring](https://blog.vicwen.app/posts/clickhouse-grafana-dashboard/)
25. [ClickHouse Series: Query Optimization Cases](https://blog.vicwen.app/posts/clickhouse-select-optimization/)
26. [ClickHouse Series: Integration with BI tools (Power BI)](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
27. [ClickHouse Series: Comparison of the pros and cons of ClickHouse Cloud and self-built deployment](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
28. [ClickHouse Series: Database Security and Access Management (RBAC) Implementation](https://blog.vicwen.app/posts/clickhouse-security-rbac/)
29. [ClickHouse Series: Kubernetes Deployment Distributed Architecture](https://blog.vicwen.app/posts/clickhouse-operator-kubernates/)
30. [ClickHouse Series: Looking at the six core mechanisms of MergeTree from the source code](https://blog.vicwen.app/posts/clickhouse-mergetree-sourcecode-introduction/)