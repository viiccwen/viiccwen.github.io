---
title: "ClickHouse Series: Building Visual Monitoring with Grafana"
published: 2025-08-27
description: ""
image: "https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress"
tags: ["ClickHouse", "Database", "Ironman", "Distributed"]
category: "software development"
draft: false
lang: "en"
---

In data analysis and system monitoring scenarios, **data visualization** is a key way to turn data into insights. ClickHouse provides powerful query and aggregation capabilities, but if you want to build real-time, interactive monitoring panels, you need to pair it with a visualization tool. Grafana is a widely used open source monitoring platform in the industry, and integrating it with ClickHouse lets you build flexible and extensible dashboards.

This article uses the following [repository](https://github.com/viiccwen/kafka-clickhouse-data-streaming-pipeline/tree/grafana-clickhouse-dashboard) to implement the examples.

## Grafana + ClickHouse Architecture

The overall architecture looks like this:

```text
Kafka / Log / API -> ClickHouse -> Grafana
```

Grafana acts as the front-end query and presentation tool. Through the ClickHouse plugin, it connects to the ClickHouse database, reads aggregated or raw data through SQL queries, and displays charts and dashboards in real time.

## Integration Steps

> Prerequisite: please first follow the implementation steps in [ClickHouse Series: Building a Real-Time Data Streaming Pipeline with Kafka](https://blog.vicwen.app/posts/clickhouse-kafka-data-streaming-pipeline/) and keep the producer running in the background.

### 1. Deploy Grafana and ClickHouse

Because the repository already uses Docker Compose to set up all services, only the newly added Grafana service is shown here:

```yaml
  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    ports:
      - "3000:3000"
    networks:
      - kafka-network
    volumes:
      - grafana-storage:/var/lib/grafana
    environment:
      - GF_INSTALL_PLUGINS=grafana-clickhouse-datasource
    depends_on:
      - clickhouse
```

> `GF_INSTALL_PLUGINS=grafana-clickhouse-datasource` means the ClickHouse plugin is preinstalled.

### 2. Configure the Data Source

![Configure Datasource](../../../assets/posts/clickhouse-grafana-dashboard/configure-datasource.png)

Go into the Grafana UI:

* Click `connections -> Data Sources -> Add data source` on the left
* Search for and select `ClickHouse`
* Fill in the connection details:

| Item | Example value |
| ---- | ------------- |
| Server address | `clickhouse` |
| Server port | `9000` |
| Credentials | Username: `default` / Password: `default` |

After the connection test succeeds, save the settings.

### 4. Build Dashboards and Charts

#### Example Query 1: Daily Event Count

```sql
SELECT
    toStartOfDay(EventDate) AS day,
    count() AS events
FROM user_events
GROUP BY day
ORDER BY day
```

Recommended settings:

* Chart type: Time Series
* Time field: `day`
* Value: `events`

#### Example Query 2: Count by Action Type

```sql
SELECT
    Action,
    count(*) AS count
FROM user_events
GROUP BY Action
ORDER BY count DESC
```

Recommended settings:

* Chart type: Bar Chart or Pie Chart
* Category dimension: `Action`
* Count value: `count`

## Time Range Control and Data Refresh

Grafana supports dynamic time ranges and automatic refresh:

* Common ranges: Last 1h, 6h, 24h, 7d, and more
* Auto refresh: 10s, 30s, 1min, and more

Each panel can customize its own time range and refresh frequency, and it also supports global time synchronization.

## Create Alert Conditions, Optional

Grafana can set alert conditions for each query:

* Set thresholds, for example event count > 100
* Notification integrations: Slack, LINE, Webhook, Email, and more

This is useful for anomaly detection and resource saturation alerts.

## Common Integration Issues and Troubleshooting Tips

| Problem | Suggested fix |
| ------- | ------------- |
| No data found | Make sure the SQL uses the time column together with `$__timeFilter()` |
| Visualization panel is empty | Check the Time field and Value field settings |
| Plugin not loaded or broken | Check version compatibility, restart Grafana, and verify the plugin configuration |
| Poor performance | Combine Materialized Views with aggregated queries so you avoid scanning large tables in real time |

## Advanced Suggestions

| Strategy | Description |
| -------- | ----------- |
| Use Materialized Views for precomputation | Write complex aggregations ahead of time so Grafana can query small tables and respond quickly |
| Add Kafka + Materialized Views for real-time streams | Combine Kafka writes into ClickHouse, store stats in MV tables, and let Grafana query them |
| Set Grafana units such as Bytes, Count, or % | Improve chart readability |
| Use Panel Variables to improve interactivity | Let users dynamically filter by page, date, user, and other dimensions |

## Summary

Grafana is a perfect visualization partner for ClickHouse. By integrating Grafana, developers can quickly build dynamic dashboards that match their needs and combine them with ClickHouse's high-performance queries to create real-time monitoring platforms.

#### ClickHouse Series Still Updated:

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
18. [ClickHouse Series: How to Improve Query Performance? system.query_log and EXPLAIN](https://blog.vicwen.app/posts/clickhouse-query-log-explain/)
19. [ClickHouse Series: Advanced Query Acceleration with Projections](https://blog.vicwen.app/posts/clickhouse-projections-optimization/)
20. [ClickHouse Series: Sampling Queries and Statistical Techniques](https://blog.vicwen.app/posts/clickhouse-sampling-statistics/)
21. [ClickHouse Series: TTL Data Cleanup and Storage Cost Optimization](https://blog.vicwen.app/posts/clickhouse-ttl-storage-management/)
22. [ClickHouse Series: Storage Policies and Disk Tiering Strategy](https://blog.vicwen.app/posts/clickhouse-storage-policies/)
23. [ClickHouse Series: Table Design and Storage Optimization Details](https://blog.vicwen.app/posts/clickhouse-schemas-storage-improvement/)
24. [ClickHouse Series: Integrating Grafana for Visual Monitoring](https://blog.vicwen.app/posts/clickhouse-grafana-dashboard/)
25. [ClickHouse Series: Query Optimization Case Studies](https://blog.vicwen.app/posts/clickhouse-select-optimization/)
26. [ClickHouse Series: Integrating with BI Tools (Power BI)](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
27. [ClickHouse Series: Pros and Cons of ClickHouse Cloud vs Self-Hosted Deployments](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
28. [ClickHouse Series: Database Security and RBAC Implementation](https://blog.vicwen.app/posts/clickhouse-security-rbac/)
29. [ClickHouse Series: Deploying Distributed Architecture on Kubernetes](https://blog.vicwen.app/posts/clickhouse-operator-kubernates/)
30. [ClickHouse Series: Six Core MergeTree Mechanisms from the Source Code](https://blog.vicwen.app/posts/clickhouse-mergetree-sourcecode-introduction/)
