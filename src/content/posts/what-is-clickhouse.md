---
title: ClickHouse 系列：ClickHouse 是什麼？與傳統 OLAP/OLTP 資料庫的差異
published: 2025-08-04
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Backend]
category: '技術'
draft: false 
lang: ''
---

ClickHouse 是由 Yandex 開發的 開源分布式列式資料庫管理系統（Column-oriented DBMS）。

主要針對 **即時數據分析** (**Real-Time Analytics**) 場景設計，能夠在秒級內處理 **PB 級**數據。

::github{repo=ClickHouse/ClickHouse}

## 特色 & 特性

| ClickHouse 技術特性| 說明 |
| ---------------- | ---------------- |
| Columnar Storage | 只讀取需要的欄位，避免不必要的 I/O。 |
| Vectorized Execution | 將資料轉成 SIMD 批次處理，加速 CPU 運算效率。|
| Compression| 各種編碼方式 (LZ4, ZSTD, Delta Encoding) 提供高壓縮比，降低儲存成本。 |
| Data Skipping Indexes | 不需掃描全部資料，可根據索引直接跳過不相關的數據區塊，查詢更快。|
| MergeTree 儲存引擎 | 強大靈活的底層結構，支援分區、排序鍵、TTL 清理機制，適合大量數據分析。|
| Materialized Views | 可將複雜查詢結果預先計算並實時更新，大幅加快查詢速度。|
| 分布式架構     | 支援 Sharding 與 Replica ，易於擴展到 PB 級數據處理規模。|
| Near-Real-Time Ingestion | 支援高吞吐量寫入 (如 Kafka Stream)，數據可秒級查詢分析。|


## OLAP v.s. OLTP 基本概念

| 分類   | OLTP (Online Transaction Processing) | OLAP (Online Analytical Processing) |
| ---- | ------------------------------------ | ----------------------------------- |
| 主要用途 | 交易處理 (CRUD 操作) | 數據分析、統計報表 |
| 操作特性 | 少量資料的頻繁寫入 | 大量資料的批次查詢 |
| 查詢型態 | 單筆/少量記錄查詢 | 大範圍聚合查詢 (Aggregation) |
| 儲存結構 | 行式存儲 (Row-based) | 列式存儲 (Column-based) |
| 代表產品 | MySQL, PostgreSQL, Oracle | ClickHouse, Druid, Redshift |

## ClickHouse 與傳統 OLAP 資料庫的差異

| 項目   | ClickHouse                      | 傳統 Data Warehouse (如 Oracle DW, Teradata) |
| ---- | ------------------------------- | ----------------------------------------- |
| 架構   | 分布式列式存儲| 多數為行式存儲或需額外配置列式引擎 |
| 查詢速度 | 毫秒級到秒級回應| 通常需數秒到數分鐘 |
| 硬體需求 | 可用商用硬體 | 多數需昂貴專用伺服器 |
| 成本   | 開源免費/雲端計價模式 | 軟硬體成本高昂 |
| 延展性  | 支援線性水平擴展 (Sharding/Replication) | 擴展成本高 |


## ClickHouse 與 OLTP 資料庫（如 MySQL, PostgreSQL）的差異

1. OLTP 資料庫在於 ACID 交易完整性、寫入頻繁的即時處理。
2. ClickHouse 更適合「**大量讀取查詢**」且「**不需要頻繁即時修改**」的場景（如報表查詢、BI 分析）。
3. OLTP 常見的 UPDATE/DELETE 操作在 ClickHouse 中屬於非即時（Mutation 機制）。

## ClickHouse 系列持續更新中:

1. [ClickHouse 系列：ClickHouse 是什麼？與傳統 OLAP/OLTP 資料庫的差異](https://blog.vicwen.app/posts/what-is-clickhouse/)
2. [ClickHouse 系列：ClickHouse 為什麼選擇 Column-based 儲存？講解 Row-based 與 Column-based 的核心差異](https://blog.vicwen.app/posts/clickhouse-column-row-based-storage/)
3. [ClickHouse 系列：ClickHouse 儲存引擎 - MergeTree](https://blog.vicwen.app/posts/clickhouse-mergetree-engine)