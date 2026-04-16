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

As data keeps growing, eliminating manual cleanup work and using automation to remove expired data and control storage costs has become an important part of large-scale system design. ClickHouse provides a **TTL (Time To Live) cleanup mechanism** that not only deletes expired data automatically, but can also move data to cold storage such as S3 or HDD, effectively reducing storage costs.

## What is TTL?

TTL (Time To Live) defines the "life cycle" of data. When data reaches the specified condition, ClickHouse automatically cleans it up, deletes it, or moves it to another storage volume.

TTL can be applied to:

1. **Entire Row Data (Row TTL)** → Automatically delete expired data.
2. **Field data (Column TTL)** -> Clean up the specified fields.
3. **Volume TTL** -> Move data from SSD to different volumes such as HDD or S3 to reduce storage costs.

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

This makes ClickHouse automatically clear the data after `EventDate` is older than 7 days.

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

The data in `TempField` will be cleared after 1 day, but the row itself will still be retained.

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

* Data from the first 7 days will stay on SSD (hot).
* After 7 days, data will be automatically moved to HDD (cold).

## TTL cleaning principle and execution timing

| Trigger timing | Description |
| ---------------------- | --------------------------------- |
| **Background Merge (Merge)** | TTL cleanup and volume movement are processed together during the Merge phase. |
| **ALTER TABLE FREEZE** | Can be forced to trigger manually. |
| **Cleaning is non-immediate** | TTL is not immediate and depends on background merge frequency and available resources. |

Suggestions:

* Adjust **merge\_with\_ttl\_timeout** and **merge\_with\_recompression\_ttl\_timeout** settings to shorten the TTL trigger time.
* Use **system.part\_log** to track which data parts have undergone TTL actions.

## Examples

### Retain behavioral data for 7 days

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

### Move detailed logs to cold storage while keeping only the latest 3 days hot

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

1. **Check the TTL status of data parts:**

```sql
SELECT table, partition_id, min(min_ttl), min(max_ttl)
FROM system.parts
WHERE active = 1
GROUP BY table, partition_id;
```

2. **Force cleanup manually (not recommended for frequent use):**

```sql
OPTIMIZE TABLE events FINAL;
```

3. **Track part change records (`system.part_log`):**

```sql
SELECT * FROM system.part_log WHERE event_type = 'MergeParts' AND table = 'events';
```

## Conclusion

TTL is not just for removing expired data. It is also an important tool for controlling ClickHouse storage tiering (SSD -> HDD -> S3). A well-designed TTL strategy can help you strike the best balance between performance and cost. Your boss will probably appreciate that too.

### More Posts in This Series:
1. [ClickHouse Series: What Is ClickHouse? The Difference Between Traditional OLAP and OLTP Databases](https://blog.vicwen.app/posts/what-is-clickhouse/)
2. [ClickHouse Series: Why ClickHouse Uses Column-Based Storage? The Core Difference Between Row-Based and Column-Based Storage](https://blog.vicwen.app/posts/clickhouse-column-row-based-storage/)
3. [ClickHouse Series: ClickHouse Storage Engine - MergeTree](https://blog.vicwen.app/posts/clickhouse-mergetree-engine)
4. [ClickHouse Series: How Compression and Data Skipping Indexes Dramatically Speed Up Queries](https://blog.vicwen.app/posts/clickhouse-compression-skipping-index/)
5. [ClickHouse Series: ReplacingMergeTree and Data Deduplication](https://blog.vicwen.app/posts/clickhouse-replacingmergetree-deduplication/)
6. [ClickHouse Series: Practical Uses of SummingMergeTree for Aggregation](https://blog.vicwen.app/posts/clickhouse-summingmergetree-aggregation/)
7. [ClickHouse Series: Real-Time Aggregation with Materialized Views](https://blog.vicwen.app/posts/clickhouse-materialized-view/)
8. [ClickHouse Series: Partition Strategy and Partition Pruning Explained](https://blog.vicwen.app/posts/clickhouse-partition-pruning/)
9. [ClickHouse Series: Primary Key, Sorting Key, and How Granule Indexes Work](https://blog.vicwen.app/posts/clickhouse-primary-sorting-key/)
10. [ClickHouse Series: Best Practices for CollapsingMergeTree and Logical Deletes](https://blog.vicwen.app/posts/clickhouse-collapsingmergetree/)
11. [ClickHouse Series: VersionedCollapsingMergeTree and Data Conflict Resolution](https://blog.vicwen.app/posts/clickhouse-versioned-collapsingmergetree/)
12. [ClickHouse Series: Advanced Uses of AggregatingMergeTree for Real-Time Metrics](https://blog.vicwen.app/posts/clickhouse-aggregatingmergetree/)
13. [ClickHouse Series: Distributed Tables and Distributed Query Architecture](https://blog.vicwen.app/posts/clickhouse-distributed-table-architecture/)
14. [ClickHouse Series: Replicated Tables for High Availability and Zero-Downtime Upgrades](https://blog.vicwen.app/posts/clickhouse-replication-failover/)
15. [ClickHouse Series: Building a Real-Time Data Streaming Pipeline with Kafka](https://blog.vicwen.app/posts/clickhouse-kafka-data-streaming-pipeline/)
16. [ClickHouse Series: Best Practices for Batch Imports (CSV, Parquet, Native Format)](https://blog.vicwen.app/posts/clickhouse-batch-import/)
17. [ClickHouse Series: Integrating ClickHouse with External Data Sources (PostgreSQL)](https://blog.vicwen.app/posts/clickhouse-external-data-integration/)
18. [ClickHouse Series: How to Improve Query Performance with system.query_log and EXPLAIN](https://blog.vicwen.app/posts/clickhouse-query-log-explain/)
19. [ClickHouse Series: Advanced Query Acceleration with Projections](https://blog.vicwen.app/posts/clickhouse-projections-optimization/)
20. [ClickHouse Series: Sampling Queries and Statistical Techniques](https://blog.vicwen.app/posts/clickhouse-sampling-statistics/)
21. [ClickHouse Series: TTL Data Cleanup and Storage Cost Optimization](https://blog.vicwen.app/posts/clickhouse-ttl-storage-management/)
22. [ClickHouse Series: Storage Policies and Disk Resource Tiering Strategies](https://blog.vicwen.app/posts/clickhouse-storage-policies/)
23. [ClickHouse Series: Table design and storage optimization details](https://blog.vicwen.app/posts/clickhouse-schemas-storage-improvement/)
24. [ClickHouse Series: Building Visual Monitoring with Grafana](https://blog.vicwen.app/posts/clickhouse-grafana-dashboard/)
25. [ClickHouse Series: Query Optimization Case Studies](https://blog.vicwen.app/posts/clickhouse-select-optimization/)
26. [ClickHouse Series: Integrating with BI Tools (Power BI)](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
27. [ClickHouse Series: Comparing ClickHouse Cloud and Self-Hosted Deployments](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
28. [ClickHouse Series: Database Security and Access Management (RBAC) Implementation](https://blog.vicwen.app/posts/clickhouse-security-rbac/)
29. [ClickHouse Series: Deploying a Distributed Architecture on Kubernetes](https://blog.vicwen.app/posts/clickhouse-operator-kubernates/)
30. [ClickHouse Series: The Six Core MergeTree Mechanisms from the Source Code](https://blog.vicwen.app/posts/clickhouse-mergetree-sourcecode-introduction/)
