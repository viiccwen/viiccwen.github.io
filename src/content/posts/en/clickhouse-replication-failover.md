---
title: "ClickHouse Series: Replicated Tables for High Availability and Zero-Downtime Upgrades"
published: 2025-08-17
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: ["ClickHouse", "Database", "Ironman", "Distributed"]
category: 'software development'
draft: false
lang: 'en'
---

In practice, database nodes can go offline because of hardware failures, software upgrades, or network problems. How do you make sure data is not lost, queries are not interrupted, and upgrades and maintenance can still happen online? This is exactly why **high availability (HA)** architecture matters.

ClickHouse provides **Replicated Tables**, using **replication and automatic failover** to deliver data consistency and read load balancing, giving the cluster the ability to perform **zero-downtime upgrades**.

## What Are Replicated Tables?

Replicated Tables are ClickHouse's built-in replication mechanism. They depend on **ClickHouse Keeper / ZooKeeper** as the coordinator and provide the following:

1. **Replication**: automatically copy data to multiple nodes (replicas).
2. **Failover**: automatically switch to another replica when the primary fails.
3. **Load-Balanced Reads**: distribute query traffic across multiple replicas.
4. **Zero-Downtime Scaling and Upgrades**: allow replica nodes to be added or replaced without affecting data availability.

## Which MergeTree Engines Support Replication?

Most members of the MergeTree family support it, including:
* ReplicatedMergeTree
* ReplicatedReplacingMergeTree
* ReplicatedSummingMergeTree
* ReplicatedAggregatingMergeTree
* ReplicatedCollapsingMergeTree
* ReplicatedVersionedCollapsingMergeTree
* ReplicatedGraphiteMergeTree

> These engines are defined as `Replicated*MergeTree` when the table is created, along with a ZooKeeper/ClickHouse Keeper path and replica name for synchronization.

## Basic Syntax

### 1. Create a ReplicatedReplacingMergeTree

```sql
CREATE TABLE table_name
(
    EventDate DateTime,
    CounterID UInt32,
    UserID UInt32,
    ver UInt16
)
ENGINE = ReplicatedReplacingMergeTree(
    '/clickhouse/tables/{layer}-{shard}/table_name',
    '{replica}',
    ver
)
PARTITION BY toYYYYMM(EventDate)
ORDER BY (CounterID, EventDate, intHash32(UserID))
SAMPLE BY intHash32(UserID);
```

### Parameter Explanation:

This means that when multiple versions of the same row exist, based on the Primary Key, ClickHouse keeps the row with the largest `ver` value as the final result. Deduplication happens during Merge.

> What, forgot already? Go back and read this first: [ClickHouse Series: ReplacingMergeTree and the Data Deduplication Mechanism](https://blog.vicwen.app/posts/clickhouse-replacingmergetree-deduplication/) 🫵

| Parameter                                        | Description                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `/clickhouse/tables/{layer}-{shard}/table_name` | The metadata path in ZooKeeper/ClickHouse Keeper. Each replica registers under this path. `{layer}` and `{shard}` are read from `macros.xml`. |
| `{replica}`                                      | The replica name for the node, such as `replica1` or `replica2`, also read from `macros.xml`. |


### 2. Each Node Must Configure `shard` and `replica` in `macros.xml`

```xml
<yandex>
  <macros>
    <shard>01</shard>
    <replica>replica1</replica>
  </macros>
</yandex>
```

Every replica node must define its own `{shard}` and `{replica}` so it can be identified correctly in ZooKeeper/Keeper.

## Technical Principles and Notes

### 1. **Replication happens at the table level, not the whole server**

* A single ClickHouse server can contain both **Replicated Tables** and **Non-Replicated Tables**.
* Replication and sharding are independent concepts. Replication only affects table copies, not how data is sharded.

### 2. **Sharding and Replication Are Independent**

* Data between shards is independent and is not copied between them.
* **Replicas inside a shard** are synchronized through the ReplicatedMergeTree family.
* Sharding is for **horizontal data scaling**, while replicas are for **high availability and fault tolerance**.

### 3. **`INSERT` and `ALTER` Are Replicated**

* **`INSERT`**: written data is synchronized to all replicas within the same shard.
* **`ALTER`**: schema changes such as `ADD COLUMN` are also synchronized to replicas.
* **`ALTER` supports non-blocking behavior**, so it can be performed online without interrupting live queries.

### 4. **DDL such as `CREATE` / `DROP` / `ATTACH` / `DETACH` / `RENAME` Is Not Automatically Replicated**

* **`CREATE TABLE`**:

  * When `CREATE` is run on one node, that node registers as a new replica in Keeper/ZooKeeper.
  * If the table already exists on other nodes, a new replica joins synchronization automatically.
* **`DROP TABLE`**:

  * Only removes the replica on the node where the command was run, without affecting other replicas.
* **`ATTACH / DETACH TABLE`**:

  * Only affects the local table on that node.
* **`RENAME TABLE`**:

  * Only changes the table name on the current node. Replica table names can differ even though the data stays synchronized.

> **So DDL still has to be controlled by the developer through `ON CLUSTER` or manual execution on each replica.**

### 5. **Keeper / ZooKeeper Coordinates Replica Metadata**

* Replica synchronization metadata, such as the current replica list, the primary, sync progress, and leader election, is stored in ClickHouse Keeper or ZooKeeper.
* ClickHouse officially recommends **ClickHouse Keeper**, its own lightweight coordinator, because it is simpler and more stable than ZooKeeper.

### 6. **Replication Requires a Keeper Configuration Section**

In the ClickHouse config file (`config.xml`), you need to define ZooKeeper / Keeper:

```xml
<zookeeper>
    <node>
        <host>zk1</host>
        <port>2181</port>
    </node>
    <node>
        <host>zk2</host>
        <port>2181</port>
    </node>
    <node>
        <host>zk3</host>
        <port>2181</port>
    </node>
</zookeeper>
```

Or, if you use ClickHouse Keeper:

```xml
<keeper_server>
    ...
</keeper_server>
```

## Zero-Downtime Upgrade Flow

### Steps for Upgrading a Replica Node:

1. Mark the node being upgraded as **read-only traffic only** and stop writing to it.
2. Stop the ClickHouse service on that replica node.
3. Upgrade the ClickHouse version and update configs as needed.
4. After restart, the node automatically fetches missing data parts from other replicas.
5. Once the upgrade finishes, the node rejoins the cluster and resumes reads and writes.

### When Upgrading the Whole Cluster:

* Upgrade replica nodes one by one.
* Make sure at least one primary and one replica stay online at all times.
* If shard nodes also need upgrading, shift traffic to other shards or replicas first.

## Failover Behavior

| Failure Scenario             | ClickHouse Behavior                                                       |
| ---------------------------- | ------------------------------------------------------------------------- |
| Replica failure (non-primary) | The node stops serving queries, and reads automatically switch to another replica |
| Primary replica failure      | Other replicas elect a new primary through Keeper so writes continue      |
| Keeper failure (single-node) | In a Keeper cluster, a new leader is elected automatically unless a majority of nodes fail |

## Design Recommendations

| Design Strategy                                   | Description                                                                 |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| Use an odd number of Keeper nodes (3 or 5)        | Ensures quorum-based fault tolerance, allowing the coordination cluster to survive one or two failures |
| Spread replicas across different availability zones | Improves disaster recovery and avoids total outages from a single-zone failure |
| Set `insert_quorum=2` to strengthen write consistency | Requires at least N replicas to confirm a write before returning success   |
| Use Distributed Tables + ReplicatedMergeTree      | Combine sharding and replica sync to achieve both horizontal scale and high availability |

## ClickHouse Cloud vs. Self-Hosted Deployment

| Feature                    | ClickHouse Cloud                                  | Self-Hosted ClickHouse                                   |
| -------------------------- | ------------------------------------------------- | -------------------------------------------------------- |
| Creating Replicated Tables | No need to configure ZooKeeper manually; the cloud handles coordination automatically | You must deploy ClickHouse Keeper / ZooKeeper yourself   |
| Scaling replicas and shards | Dynamic scaling is handled by the cloud and is transparent to users | Nodes must be added and synchronized manually            |
| Upgrades and operations    | Node upgrades and failover are handled by the cloud | You need to plan upgrade schedules and failover flows yourself |
| Fine-grained control       | Some lower-level behavior is abstracted away       | You can fully control `clusters.xml`, macros, and Keeper settings |

## Advanced: Internal Details and Performance Impact

### 1. **ZooKeeper/ClickHouse Keeper is the foundation of replica coordination**

* Every Replicated Table has a path in ZooKeeper/Keeper for coordinating replica state and synchronization.
* If `config.xml` does not define a ZooKeeper/Keeper connection, Replicated Tables cannot be created, and existing Replicated Tables become read-only.
* You can use one ZooKeeper cluster to coordinate replicas across multiple shards, and even in large clusters with 300+ nodes, splitting the ZooKeeper cluster is generally still unnecessary because ClickHouse's coordination model is already effective.

### 2. **Replication does not affect `SELECT` performance**

* **Read queries (`SELECT`)** do not coordinate through ZooKeeper, so read performance is basically the same as on non-replicated tables.
* In Distributed + Replicated setups, these parameters can be used to control replica behavior:

  | Parameter                                               | Function                                                                 |
  | ------------------------------------------------------- | ------------------------------------------------------------------------ |
  | `max_replica_delay_for_distributed_queries`             | Defines how many seconds behind a replica is allowed to be and still serve distributed queries |
  | `fallback_to_stale_replicas_for_distributed_queries`    | Allows queries to fall back to stale replicas when up-to-date ones are unavailable |

### 3. **`INSERT` increases ZooKeeper load (around 10 transactions per data part)**

* Each `INSERT`, or more precisely each data part, with a default upper bound of 1,048,576 rows, triggers about 10 ZooKeeper transactions to coordinate replica synchronization.
* This makes `INSERT` slightly slower than on non-replicated tables, but if you follow ClickHouse's recommendation of not exceeding about one insert per second, it usually does not cause real problems in production.
* **Hundreds of inserts per second, counted in data parts, are still a stable practical scale.**

> You might be thinking: Vic, less than one `INSERT` per second sounds ridiculously weak.

That was my first reaction too. But what ClickHouse means here is **high-frequency inserts with tiny batches**. If you send many inserts per second with only a few hundred or a few thousand rows each, every insert forces ZooKeeper coordination, data-part creation, and synchronization, which can seriously overload the system.

So the better approach is still to batch data into larger writes, for example once per second with hundreds of thousands of rows, to reduce the number of data parts and avoid unnecessary ZooKeeper pressure.

### 4. **Replication is asynchronous and supports multi-master writes**

* `INSERT` and `ALTER` can be sent to any available replica. The data is written locally first and then synchronized to the others.
* Synchronization is asynchronous, so data may appear on other replicas with slight delay depending on network transfer and sync load.
* If a replica is temporarily offline, it automatically catches up after it comes back online.

### 5. **Replication only synchronizes raw data parts, while later merges happen independently on each replica**

* During `INSERT`, only compressed data parts are transferred to other replicas.
* Merge operations happen independently on each replica, but the order and results remain consistent because Keeper coordinates them.
* This greatly reduces network traffic and allows efficient operation even across data centers.

### 6. **By default, `INSERT` waits for only one replica to succeed (not quorum write)**

* By default, an `INSERT` returns success as soon as one replica confirms the write.
* That means if that replica later fails permanently, the write may be lost.
* If you need the write to be confirmed by multiple replicas, enable:

  ```sql
  SET insert_quorum = 2;
  ```

  Then success is returned only after at least two replicas confirm the write.

### 7. **`INSERT` is atomic, idempotent, and supports deduplication**

* Every data part is written atomically.
* If the client resends the same data because of a network problem, ClickHouse automatically checks for duplicate data parts based on content and order.
* `INSERT` is idempotent, so the result is consistent no matter which replica receives it.

### 8. **Background sync and fetch tasks can be tuned**

| Parameter                        | Function                                                                 |
| -------------------------------- | ------------------------------------------------------------------------ |
| `background_schedule_pool_size`  | Controls the number of threads used for background Merge, mutations, and similar tasks |
| `background_fetches_pool_size`   | Controls the number of threads used to fetch replicated data; a server restart is required for changes to take effect |

## Practical Advice

| Item             | Recommendation                                                             |
| ---------------- | -------------------------------------------------------------------------- |
| `INSERT` frequency | Keep inserts below about once per second when possible, and batch large writes |
| ZooKeeper load   | If insert frequency is extremely high, consider using different ZooKeeper clusters for different shards |
| Cross-data-center sync | Replicated Tables are especially suitable for HA sync across data centers |
| Strong write consistency | Enable `insert_quorum` if multi-replica confirmation is required      |

## Conclusion

With ClickHouse Replicated Tables, we can achieve data consistency, balanced query load, and real zero-downtime upgrades.
For data platforms that combine high-ingest writes, large-scale queries, and strict availability requirements, this is a core architectural building block.


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
