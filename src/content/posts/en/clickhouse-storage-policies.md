---
title: "ClickHouse Series: Storage Policies and Disk Tiering Strategy"
published: 2025-08-25
description: ""
image: "https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress"
tags: ["ClickHouse", "Database", "Ironman"]
category: "software development"
draft: false
lang: "en"
---

As your ClickHouse data grows from GB to TB and then to PB, **how to properly allocate SSD, HDD, and even cloud cold storage resources** becomes critical. Through **Storage Policies**, ClickHouse provides a very flexible disk tiering architecture that not only improves query performance, but also significantly reduces storage costs.

## What Are Storage Policies?

Storage Policies are the configuration mechanism ClickHouse uses to manage where data is stored and how it is tiered. They divide disk resources into different levels, or volumes, and dynamically move data between disk tiers based on data size, TTL, merge conditions, and similar rules.

You can do the following:
1. Keep hot data on SSD and automatically move cold data to HDD or cloud S3.
2. Dynamically schedule storage locations based on Data Part size.
3. Combine with TTL policies to automate the full data lifecycle.

## Storage Policy Structure

```xml
<storage_configuration>
    <disks>
        <disk_ssd>
            <path>/var/lib/clickhouse/ssd/</path>
        </disk_ssd>
        <disk_hdd>
            <path>/var/lib/clickhouse/hdd/</path>
        </disk_hdd>
        <disk_s3>
            <type>s3</type>
            <endpoint>https://s3.amazonaws.com/your-bucket/</endpoint>
            <access_key_id>YOUR_KEY</access_key_id>
            <secret_access_key>YOUR_SECRET</secret_access_key>
        </disk_s3>
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
                <archive>
                    <disk>disk_s3</disk>
                </archive>
            </volumes>
        </tiered_policy>
    </policies>
</storage_configuration>
```

## Design Principles for Disk Tiering

| Tier | Disk type | Suitable data | Description |
| ---- | --------- | ------------- | ----------- |
| **Hot** | SSD | High-frequency queries from the last 7 days | Ensures read speed and low latency |
| **Cold** | HDD | Historical data or low-frequency queries | Lower storage cost, suitable for cold data |
| **Archive** | S3 | Archived data that is rarely queried but must be retained long term | Cross-region backup, effectively unlimited capacity, lowest cost |

## Using TTL to Automate Hot and Cold Tiering

```sql
CREATE TABLE user_logs
(
    EventDate DateTime,
    UserID UInt64,
    Action String
) ENGINE = MergeTree
ORDER BY (UserID, EventDate)
SETTINGS storage_policy = 'tiered_policy'
TTL EventDate + INTERVAL 7 DAY TO VOLUME 'cold',
    EventDate + INTERVAL 30 DAY TO VOLUME 'archive';
```

With this design:

* Data from the last 7 days stays on SSD.
* Data from 7 to 30 days moves to HDD.
* Data older than 30 days is automatically moved to S3.

## Observing Data Distribution

```sql
SELECT
    name AS table_name,
    disk_name,
    count() AS parts
FROM system.parts
WHERE active AND table = 'user_logs'
GROUP BY table_name, disk_name;
```

This lets you instantly see whether the data is stored on SSD, HDD, or S3.

## How Storage Policies Interact with MergeTree

* **New data is written to the hot volume** unless it exceeds the part size limit.
* **During background merges, data is moved to lower volumes according to part size and TTL rules**.
* **The choice and allocation of storage tiers are completely determined by Storage Policies**, so there is no manual intervention required.

## Best Practices for Storage Policies

1. **Make the tiering design fully automatic** -> no manual data movement should be required.
2. **Choose suitable disk paths and mount points** -> SSD for hot data, HDD for cold data, S3 for historical archive.
3. **Use TTL for time-series data management** -> automatic cleanup and tiered storage.
4. **Monitor `system.parts` and `part_log`** -> regularly check part movement and execution performance.

## Advanced: Monitoring Storage Policy Behavior

ClickHouse provides the `system.storage_policies` system table, which lets you inspect **Storage Policies and Volume configuration** at any time and understand disk priority and tiering logic.

### Understanding `system.storage_policies`

| Column | Description |
| ------ | ----------- |
| **policy_name** | Storage policy name. |
| **volume_name** | Name of the volume it belongs to. |
| **volume_priority** | Volume priority. Smaller numbers mean higher priority, with 0 being the highest. |
| **disks** | The list of disks contained in the volume. |
| **volume_type** | Volume type (`JBOD`, `SINGLE_DISK`, `UNKNOWN`). |
| **max_data_part_size** | Maximum Data Part size that the volume can store (`0` means unlimited). |
| **move_factor** | When free space in the volume becomes insufficient, ClickHouse moves data to the next volume. |
| **prefer_not_to_merge** | Whether merges should be avoided on this volume. In theory, this is not recommended. |
| **perform_ttl_move_on_insert** | Whether TTL moves should happen immediately on insert if the rule matches. |
| **load_balancing** | Load-balancing strategy for writes when multiple disks exist in a volume (`ROUND_ROBIN` or `LEAST_USED`). |

### Checking Storage Policy and Volume Configuration

```sql
SELECT
    policy_name,
    volume_name,
    volume_priority,
    disks,
    volume_type,
    max_data_part_size,
    move_factor,
    load_balancing
FROM system.storage_policies
WHERE policy_name = 'tiered_policy';
```

## Conclusion

ClickHouse Storage Policies are more than a disk resource management tool. They are a core tool for optimizing storage cost at scale. If designed well, they give your ClickHouse cluster automatic storage tiering along with a strong balance between performance and cost.

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
