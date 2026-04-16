---
title: "What Are OLAP and OLTP?"
published: 2025-08-03
description: ''
image: ''
tags: ["Backend"]
category: 'software development'
draft: true 
lang: 'en'
---

## OLTP (Online Transaction Processing)

:::important
High-frequency reads and writes, small amounts of data, transaction safety
:::

OLTP systems are used to handle large volumes of real-time transactions, such as inserts, updates, and deletes. Their goal is to guarantee data correctness and consistency while supporting a large number of small read/write operations.

| Feature | Description |
| ------ | ----------- |
| Data operation types | `INSERT`, `UPDATE`, `DELETE`, `SELECT` (single-record queries) |
| Data scale | Small amount of data per operation, but transactions happen frequently |
| Emphasis | ACID transaction integrity (Atomicity, Consistency, Isolation, Durability) |
| Storage model | Row-based storage |
| Performance focus | Extremely low latency (millisecond-level response) and strong concurrent write capability |

Examples include MySQL, PostgreSQL, Oracle Database, and SQL Server, all of which are OLTP systems.

## OLAP (Online Analytical Processing)

:::important
Batch queries, aggregated statistics, large-scale data analysis
:::

OLAP systems are designed specifically for **analyzing large amounts of historical data**. They support complex queries, data aggregation, and multidimensional analysis, with the goal of helping organizations gain insights from data quickly.

| Feature | Description |
| ------ | ----------- |
| Data operation types | `SELECT` (large-scale aggregate queries, `JOIN`, `GROUP BY`) |
| Data scale | Massive historical data sets (GB to PB scale), with queries spanning millions of rows |
| Emphasis | Query efficiency and multidimensional analysis capabilities |
| Storage model | Column-based storage |
| Performance focus | Fast batch reads and query latency in the second range, or even milliseconds in some cases |

Examples include ClickHouse, Apache Druid, and Google BigQuery, all of which are OLAP systems.

## Comparison

| Comparison Item | OLTP | OLAP |
| ------- | ---- | ---- |
| Main purpose | Online transaction processing (business systems) | Large-scale analytical processing (BI/reporting) |
| Query characteristics | Single-record queries, frequent writes | Batch queries, large reads, and aggregation |
| Storage model | Row-based storage | Column-based storage |
| Data consistency requirements | Extremely high (ACID transaction integrity) | Eventual consistency is acceptable |
| Typical products | MySQL, PostgreSQL, Oracle | ClickHouse, Druid, Redshift |
| Latency requirements | Sub-second (millisecond-level response) | Seconds or lower, depending on query and hardware architecture |
| Operation type | `INSERT`, `UPDATE`, `DELETE`, `SELECT` | `SELECT` (`JOIN`, `GROUP BY`, aggregation) |

## Row-based? Column-based?

At this point, you might ask: what exactly are Column-based and Row-based storage?

### Row-based Storage

:::note
Data is stored on disk one full row at a time.
:::

* It is efficient for **fast reads or modifications of individual records**.
* It is well suited for OLTP systems, where transactions are frequent and writes and updates are the main focus.

Suppose we have the following table:

| UserID | Name  | Age | Country |
| ------ | ----- | --- | ------- |
| 1      | Alice | 25  | USA     |
| 2      | Bob   | 30  | UK      |

Row-based storage would store the data like this:

```
[1, Alice, 25, USA] → [2, Bob, 30, UK]
```

Each query reads **an entire row of data, meaning all columns are read together**. This is suitable when query conditions are based on a primary key like `UserID`, or when data is frequently written and updated, such as modifying an order status.

### Column-based Storage

:::note
Data is stored separately by column.
:::

* It is extremely efficient for **large-scale reads and aggregate queries** such as `SUM`, `AVG`, and `COUNT`.
* It is well suited for OLAP systems, where the main goal is to read large amounts of data for analysis.

Using the same table as above, column-based storage would look like this:

```
[1, 2] → [Alice, Bob] → [25, 30] → [USA, UK]
```

If a query only needs the `Age` column, the system only needs to read the data for that one column. This makes it ideal for statistical and analytical workloads that only read part of the columns, such as `COUNT` and `SUM`, or large batch queries over millions of rows.


## Conclusion

Most everyday application development uses OLTP databases, since the focus is usually on real-time transaction handling and ACID guarantees. I only happened to come across data volumes at the TB to PB scale by chance, and that was when I learned that OLAP systems even existed. In the next article, I’ll start introducing one of those databases, ClickHouse, which is one type of OLAP system.
