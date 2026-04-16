---
title: "ClickHouse Series: Integrating ClickHouse with External Data Sources (PostgreSQL)"
published: 2025-08-20
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, Ironman, Distributed]
category: 'software development'
draft: false 
lang: 'en'
---

In real-world data platform architectures, ClickHouse is usually not the only database. Instead, it is integrated with other data sources such as MySQL, PostgreSQL, S3, and Kafka, serving as a **high-performance query and analytics layer**.

This article demonstrates how to use the **PostgreSQL Table Engine** and the **MaterializedPostgreSQL Database Engine (experimental)** so ClickHouse can directly query PostgreSQL data and enable real-time cross-database analytics.

## Why Integrate PostgreSQL?

In many application scenarios, PostgreSQL stores business data as an **OLTP system** (such as transactions, users, and orders), but reporting and analytics often run into the following challenges:

* OLTP query performance cannot satisfy large-scale aggregation analysis
* Avoiding data inconsistency caused by ETL transfer delays
* Not wanting to replicate the full dataset, and only needing real-time access to part of the data

ClickHouse's **PostgreSQL Table Engine** can connect directly to PostgreSQL and query data as if it were an "external table," making it suitable for quickly integrating data from multiple sources.

## PostgreSQL Table Engine — Real-Time Bidirectional Querying and Inserts

### Suitable Scenarios

* You do not need full synchronization and only want to query PostgreSQL data in real time
* You need to insert data back into PostgreSQL directly from ClickHouse
* The data volume is relatively small, but real-time requirements are high

### PostgreSQL-Side Setup

1. **Allow network connections**

   ```ini
   # postgresql.conf
   listen_addresses = '*'
   ```

2. **Create a user**

   ```sql
   CREATE ROLE clickhouse_user SUPERUSER LOGIN PASSWORD 'ClickHouse_123';
   ```

3. **Create a database and table**

   ```sql
   CREATE DATABASE db_in_psg;

   CREATE TABLE table1 (
       id integer primary key,
       column1 varchar(10)
   );

   INSERT INTO table1 VALUES (1, 'abc'), (2, 'def');
   ```

4. **Configure connection permissions**

   ```ini
   # pg_hba.conf
   host    db_in_psg  clickhouse_user  192.168.1.0/24  password
   ```

5. **Reload the configuration**

   ```bash
   pg_ctl reload
   ```

---

### ClickHouse-Side Setup

1. **Create a database**

   ```sql
   CREATE DATABASE db_in_ch;
   ```

2. **Create a connected table**

   ```sql
   CREATE TABLE db_in_ch.table1
   (
       id UInt64,
       column1 String
   )
   ENGINE = PostgreSQL(
       'postgres-host.domain.com:5432',
       'db_in_psg',
       'table1',
       'clickhouse_user',
       'ClickHouse_123'
   );
   ```

3. **Test the query**

   ```sql
   SELECT * FROM db_in_ch.table1;
   ```

4. **Bidirectional test**

   * Insert data in PostgreSQL, and ClickHouse can query it
   * Insert data in ClickHouse, and PostgreSQL can query it

---

## MaterializedPostgreSQL Database Engine — Continuous Data Synchronization (CDC)

### Suitable Scenarios

* You need to continuously synchronize an entire PostgreSQL database or multiple tables into ClickHouse
* Data updates happen frequently
* Suitable for reporting and real-time analytics

### Notes

* **Experimental feature**, must be explicitly enabled
* ClickHouse does not support directly modifying synchronized tables (to avoid conflicts with CDC)
* Best suited for **read-only analytics** scenarios

---

### PostgreSQL-Side Setup

1. **Enable replication**

   ```ini
   # postgresql.conf
   listen_addresses = '*'
   max_replication_slots = 10
   wal_level = logical
   ```

2. **Create a user and database**

   ```sql
   CREATE ROLE clickhouse_user SUPERUSER LOGIN PASSWORD 'ClickHouse_123';
   CREATE DATABASE db1;
   ```

3. **Create a table and seed data**

   ```sql
   \connect db1
   CREATE TABLE table1 (
       id integer primary key,
       column1 varchar(10)
   );
   INSERT INTO table1 VALUES (1, 'abc'), (2, 'def');
   ```

4. **Configure permissions**

   ```ini
   # pg_hba.conf
   host    db1  clickhouse_user  192.168.1.0/24  password
   ```

---

### ClickHouse-Side Setup

1. **Enable the experimental feature**

   ```sql
   SET allow_experimental_database_materialized_postgresql=1;
   ```

2. **Create a synchronized database**

   ```sql
   CREATE DATABASE db1_postgres
   ENGINE = MaterializedPostgreSQL(
       'postgres-host.domain.com:5432',
       'db1',
       'clickhouse_user',
       'ClickHouse_123'
   )
   SETTINGS materialized_postgresql_tables_list = 'table1';
   ```

3. **Verify the data**

   ```sql
   SELECT * FROM db1_postgres.table1;
   ```

4. **Test synchronization**
   Insert data in PostgreSQL, and ClickHouse will update automatically.

---

## Recommended Strategy

| Feature | PostgreSQL Table Engine | MaterializedPostgreSQL |
| ----- | ----------------------- | ---------------------- |
| Access method | Real-time querying and writing | Continuous replication (read-only) |
| Suitable data volume | Small batches, real-time queries | Large batches, long-term analytics |
| Latency | Real-time query latency (depends on PostgreSQL response time) | Low latency (CDC sync) |
| Restrictions | Limited by PostgreSQL performance | Experimental feature, not writable |

## How It Works and Its Limitations

### Advantages

* Query PostgreSQL in real time without ETL first
* Can JOIN with native ClickHouse tables
* Suitable for low-latency data integration needs

### Limitations

* Query performance is constrained by PostgreSQL response speed
* Latency is higher when scanning large amounts of data
* Suitable for real-time querying of small batches of data, but not for full historical analysis on large tables
  (in those cases, it is recommended to use `clickhouse-copier` or ETL tools to import historical data into ClickHouse)

## Summary

With the PostgreSQL Table Engine, ClickHouse can directly access real-time data in PostgreSQL and enable cross-system analytics, making it especially suitable for hybrid queries and real-time BI reporting needs.

In practice, it is recommended to:

* Use ETL to load large tables into ClickHouse
* Query small tables or the latest data through external tables
* Combine with Materialized Views for real-time aggregation

#### ClickHouse Series Ongoing:

1. [ClickHouse Series: What Is ClickHouse? Differences from Traditional OLAP/OLTP Databases](https://blog.vicwen.app/posts/what-is-clickhouse/)
2. [ClickHouse Series: Why Does ClickHouse Use Column-Based Storage? Explaining the Core Differences Between Row-Based and Column-Based Storage](https://blog.vicwen.app/posts/clickhouse-column-row-based-storage/)
3. [ClickHouse Series: ClickHouse Storage Engine - MergeTree](https://blog.vicwen.app/posts/clickhouse-mergetree-engine)
4. [ClickHouse Series: How Compression Techniques and Data Skipping Indexes Dramatically Speed Up Queries](https://blog.vicwen.app/posts/clickhouse-compression-skipping-index/)
5. [ClickHouse Series: ReplacingMergeTree and the Data Deduplication Mechanism](https://blog.vicwen.app/posts/clickhouse-replacingmergetree-deduplication/)
6. [ClickHouse Series: Application Scenarios for Data Aggregation with SummingMergeTree](https://blog.vicwen.app/posts/clickhouse-summingmergetree-aggregation/)
7. [ClickHouse Series: Real-Time Aggregation Queries with Materialized Views](https://blog.vicwen.app/posts/clickhouse-materialized-view/)
8. [ClickHouse Series: Partitioning Strategies and Partition Pruning Explained](https://blog.vicwen.app/posts/clickhouse-partition-pruning/)
9. [ClickHouse Series: How Primary Key, Sorting Key, and Granule Indexing Work](https://blog.vicwen.app/posts/clickhouse-primary-sorting-key/)
10. [ClickHouse Series: Best Practices for CollapsingMergeTree and Logical Deletion](https://blog.vicwen.app/posts/clickhouse-collapsingmergetree/)
11. [ClickHouse Series: Version Control and Data Conflict Resolution with VersionedCollapsingMergeTree](https://blog.vicwen.app/posts/clickhouse-versioned-collapsingmergetree/)
12. [ClickHouse Series: Advanced Applications of AggregatingMergeTree for Real-Time Metrics](https://blog.vicwen.app/posts/clickhouse-aggregatingmergetree/)
13. [ClickHouse Series: Distributed Tables and Distributed Query Architecture](https://blog.vicwen.app/posts/clickhouse-distributed-table-architecture/)
14. [ClickHouse Series: High Availability and Zero-Downtime Upgrades with Replicated Tables](https://blog.vicwen.app/posts/clickhouse-replication-failover/)
15. [ClickHouse Series: Building a Real-Time Data Streaming Pipeline with Kafka Integration](https://blog.vicwen.app/posts/clickhouse-kafka-data-streaming-pipeline/)
16. [ClickHouse Series: Best Practices for Batch Imports (CSV, Parquet, Native Format)](https://blog.vicwen.app/posts/clickhouse-batch-import/)
17. [ClickHouse Series: Integrating ClickHouse with External Data Sources (PostgreSQL)](https://blog.vicwen.app/posts/clickhouse-external-data-integration/)
18. [ClickHouse Series: How to Improve Query Optimization? Using system.query_log and EXPLAIN](https://blog.vicwen.app/posts/clickhouse-query-log-explain/)
19. [ClickHouse Series: Advanced Query Acceleration with Projections](https://blog.vicwen.app/posts/clickhouse-projections-optimization/)
20. [ClickHouse Series: Principles of Sampling Queries and Statistical Techniques](https://blog.vicwen.app/posts/clickhouse-sampling-statistics/)
21. [ClickHouse Series: TTL Data Cleanup and Storage Cost Optimization](https://blog.vicwen.app/posts/clickhouse-ttl-storage-management/)
22. [ClickHouse Series: Storage Policies and Tiered Disk Resource Strategies](https://blog.vicwen.app/posts/clickhouse-storage-policies/)
23. [ClickHouse Series: Table Design and Storage Optimization Details](https://blog.vicwen.app/posts/clickhouse-schemas-storage-improvement/)
24. [ClickHouse Series: Integrating Grafana for Visual Monitoring](https://blog.vicwen.app/posts/clickhouse-grafana-dashboard/)
