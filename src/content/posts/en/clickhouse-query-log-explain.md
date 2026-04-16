---
title: "ClickHouse Series: How to Improve Query Performance with system.query_log and EXPLAIN"
published: 2025-08-21
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, Ironman]
category: 'software development'
draft: false 
lang: 'en'
---

As data volumes continue to grow, optimizing query performance becomes a core skill every developer needs to have. This article walks through two powerful ClickHouse tools for query optimization:

1. **system.query\_log** → query execution history and performance
2. **EXPLAIN** → estimated query paths and resource usage


## What Is system.query_log?

`system.query_log` is ClickHouse's built-in query history table. It records the following for every query:
* Start time and execution duration
* Resource usage (rows read, memory usage)
* Query errors and exceptions
* User, source IP, and client information
* Storage, functions, and events used by the query

:::warning
This only records information about query execution. It does not record the query result data itself.
:::

### Query the Most Recent 100 SELECT Execution Records

```sql
SELECT
    query_start_time,
    query_duration_ms,
    read_rows,
    result_rows,
    query
FROM system.query_log
WHERE event_time > now() - INTERVAL 10 MINUTE
AND type = 'QueryFinish'
AND query LIKE 'SELECT%'
ORDER BY query_start_time DESC
LIMIT 100;
```

### Common Field Definitions

| Field | Description |
| ------------------- | ------------------- |
| query\_start\_time | Query start time |
| query\_duration\_ms | Query duration (milliseconds) |
| read\_rows | Number of rows read during query execution |
| result\_rows | Number of rows output by the query result |
| memory\_usage | Memory usage during query execution (bytes) |

| `type` value | Description |
| ---------------------------- | ------------ |
| `QueryStart` = 1 | Recorded when the query starts executing |
| `QueryFinish` = 2 | Recorded when the query completes successfully |
| `ExceptionBeforeStart` = 3 | Recorded when the query fails before execution starts |
| `ExceptionWhileProcessing`=4 | Recorded when the query fails during execution |


### How Do You Find "Slow Queries"?

```sql
SELECT
    query_start_time,
    query_duration_ms,
    read_rows,
    memory_usage,
    query
FROM system.query_log
WHERE event_time > now() - INTERVAL 1 HOUR
AND type = 'QueryFinish'
AND query_duration_ms > 500  -- greater than 500ms
ORDER BY query_duration_ms DESC;
```


## What Is EXPLAIN?

ClickHouse provides the `EXPLAIN` syntax so you can predict details such as the **query path, amount of scanned data, and JOIN strategy** before actually running the query.

### EXPLAIN SYNTAX:

```sql
EXPLAIN [AST | SYNTAX | QUERY TREE | PLAN | PIPELINE | ESTIMATE | TABLE OVERRIDE] [settings]
SELECT ...
```

| Mode | Description |
| -------------- | ---------------------------------- |
| AST | Displays the query's Abstract Syntax Tree. |
| SYNTAX | Displays the query structure after syntax optimization. |
| QUERY TREE | Displays the query logic tree, reflecting the structure after optimizer processing. |
| PLAN | The query execution plan path (including scanned tables, JOIN strategy, and more). |
| PIPELINE | Query execution stages and parallelism information (threads, pipeline processors, etc.). |
| ESTIMATE | Estimates how much data the query will scan (rows, marks, parts). |
| TABLE OVERRIDE | Verifies whether a table function schema override is correct. |


## EXPLAIN Examples

### SYNTAX - The Query After Syntax Optimization

```sql
EXPLAIN SYNTAX SELECT * FROM system.numbers WHERE number < 10;
```

```sql
SELECT *
FROM system.numbers
WHERE number < 10
```

### QUERY TREE — Final Query Logic Structure

```sql
EXPLAIN QUERY TREE SELECT id, value FROM test_table;
```

```sql
QUERY id: 0
  PROJECTION COLUMNS
    id UInt64
    value String
  JOIN TREE
    TABLE id: 3, table_name: default.test_table
```

This makes it clear how the query is structured and which columns will be projected.

### PLAN - Execution Plan Steps

```sql
EXPLAIN PLAN SELECT sum(number) FROM numbers(1000) GROUP BY number % 4;
```

```sql
Union
 Expression (Projection)
  Aggregating
   ReadFromStorage (SystemNumbers)
```

You can see the entire execution path from reading data to aggregation.

### ESTIMATE — Estimated Query Read Volume

```sql
EXPLAIN ESTIMATE SELECT * FROM large_table WHERE date >= '2024-01-01';
```

```sql
┌─database─┬─table──────┬─parts─┬─rows───┬─marks─┐
│ default  │ large_table│     2 │ 500000 │    32 │
└──────────┴────────────┴───────┴────────┴───────┘
```

## Advanced: Optimizing a Slow Query

1. First, use **system.query\_log** to find recent slow queries.

```sql
SELECT
    query_start_time,
    query_duration_ms,
    read_rows,
    read_bytes,
    memory_usage,
    query
FROM system.query_log
WHERE event_time > now() - INTERVAL 1 HOUR
AND type = 'QueryFinish'
AND query LIKE '%order_summary%'
ORDER BY query_duration_ms DESC
LIMIT 5;
```

```sql
query_duration_ms: 4500ms
read_rows: 100000000
query: SELECT region, SUM(amount) FROM order_summary GROUP BY region;
```

2. Use **EXPLAIN PLAN** on that SQL to predict the path and data volume.

```sql
EXPLAIN PLAN SELECT region, SUM(amount) FROM order_summary GROUP BY region;
```

```sql
Expression (Projection)
 Aggregating
  ReadFromMergeTree (order_summary)
```

> Full table scan!

3. Check whether:
   * There is a full table scan (data blocks are too large).
   * There are unnecessary JOINs → can they be turned into a Materialized View?
   * Partition pruning is missing, causing indexes to be ineffective.

> * The query condition does not include the partition key (`date`).
> * `order_summary` is partitioned by (`date`, `region`), but the query does not include a date range → full table scan.
> * You can consider precomputing region aggregations into a Materialized View.

4. Adjust the query conditions (for example, add a partition key range or a Data Skipping Index).

```sql
SELECT region, SUM(amount)
FROM order_summary
WHERE date = today() - 1
GROUP BY region;
```

5. Check **query\_log** again → see whether the query duration decreases.

```sql
SELECT query_duration_ms FROM system.query_log
WHERE query LIKE '%order_summary%'
AND event_time > now() - INTERVAL 5 MINUTE
AND type = 'QueryFinish'
ORDER BY query_start_time DESC
LIMIT 1;
```

```sql
query_duration_ms: 300ms
```

> `4500ms` -> `300ms`
>
> A 15x improvement.

## Advanced: Optimizing a Global Scan

```sql
SELECT user_id, COUNT(*) FROM user_events GROUP BY user_id;
```

1. Run `EXPLAIN PLAN` to confirm whether the Primary Key index is being used.

```sql
EXPLAIN PLAN SELECT user_id, COUNT(*) FROM user_events GROUP BY user_id;
```

```sql
Expression (Projection)
 Aggregating
  ReadFromMergeTree (user_events)
```

> No index filtering at all, just a direct full table scan.

2. If not, add a Partition Pruning condition.

The Partition Key of `user_events` is `EventDate`, so we add a date range:

```sql
SELECT user_id, COUNT(*)
FROM user_events
WHERE EventDate >= today() - 7
GROUP BY user_id;
```

3. Use `EXPLAIN ESTIMATE` to check whether the scan volume decreases.

```sql
EXPLAIN ESTIMATE
SELECT user_id, COUNT(*)
FROM user_events
WHERE EventDate >= today() - 7;
```

```sql
┌─database─┬─table────────┬─parts─┬─rows──────┬─marks─┐
│ default  │ user_events  │     3 │ 10000000  │   800 │
└──────────┴──────────────┴───────┴───────────┴───────┘
```

> Originally, without the condition, the query scanned 100 million rows. Now it only scans 10 million rows, a clear reduction in data volume.

4. Check whether `PIPELINE` shows parallel processing.

```sql
EXPLAIN PIPELINE
SELECT user_id, COUNT(*)
FROM user_events
WHERE EventDate >= today() - 7
GROUP BY user_id;
```

> Confirm that the query can use multiple `AggregatingTransform` nodes for parallel processing.

5. Query `system.query_log` again to verify whether the execution time has decreased.

```sql
SELECT query_duration_ms FROM system.query_log
WHERE query LIKE '%user_events%'
AND event_time > now() - INTERVAL 5 MINUTE
AND type = 'QueryFinish'
ORDER BY query_start_time DESC
LIMIT 1;
```

```sql
query_duration_ms: 600ms
```

## Conclusion
`EXPLAIN` is a core tool for optimizing query performance in ClickHouse. Through its different modes, you can:
* Understand the query execution structure
* Predict the query's resource consumption
* Find bottlenecks and optimize them precisely

By making `EXPLAIN` part of your query development workflow, you can move from "writing queries based on experience" to becoming someone who optimizes performance with data-driven decisions.
