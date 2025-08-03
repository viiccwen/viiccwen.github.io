---
title: OLAP 和 OLTP 是什麼？
published: 2025-08-03
description: ''
image: ''
tags: [Backend]
category: '技術'
draft: true 
lang: ''
---

## OLTP（Online Transaction Processing 線上交易處理）

:::important
高頻讀寫、少量資料、交易安全
:::

用來處理大量即時事務（如新增、修改、刪除）的系統，目的是保證資料正確性與一致性，並支援大量小型讀寫操作。

| 特徵     | 說明                                 |
| ------ | ---------------------------------- |
| 資料操作類型 | INSERT、UPDATE、DELETE、SELECT (單筆查詢) |
| 資料規模   | 單次操作數據量小，但交易頻繁                     |
| 強調     | ACID 交易完整性 (原子性、一致性、隔離性、持久性)       |
| 儲存結構   | 行式存儲 (Row-based)                   |
| 效能考量   | 延遲需極低 (毫秒級反應)、高並發寫入能力              |

像是：MySQL、PostgreSQL、Oracle Database、SQL Server 都是屬於 OLTP。

## OLAP（Online Analytical Processing 線上分析處理）

:::important
批次查詢、聚合統計、大量資料分析
:::

專門為**分析大量歷史資料設計**的系統，支援複雜查詢、資料彙總與多維度分析，目的是幫助企業快速進行數據洞察。

| 特徵     | 說明                              |
| ------ | ------------------------------- |
| 資料操作類型 | SELECT (大量讀取聚合查詢，JOIN、GROUP BY) |
| 資料規模   | 巨量歷史數據（GB\~PB 級），查詢橫跨數百萬筆資料     |
| 強調     | 查詢效率與多維度分析能力                    |
| 儲存結構   | 列式存儲 (Column-based)             |
| 效能考量   | 批次讀取速度快、查詢延遲秒級（甚至毫秒級）           |

舉例如：ClickHouse、Apache Druid、Google BigQuery 都是屬於 OLAP。

## 對比

| 比較項目    | OLTP                        | OLAP                            |
| ------- | --------------------------- | ------------------------------- |
| 主要用途    | 線上交易處理 (業務系統)               | 大數據分析處理 (BI/報表分析)               |
| 查詢特性    | 單筆查詢、頻繁寫入                   | 批次查詢、大量讀取與聚合                    |
| 儲存結構    | 行式存儲 (Row-based)            | 列式存儲 (Column-based)             |
| 資料一致性需求 | 極高 (ACID 交易完整性)             | 可接受最終一致性 (Eventual Consistency) |
| 典型產品    | MySQL、PostgreSQL、Oracle     | ClickHouse、Druid、Redshift       |
| 延遲要求    | 亞秒級 (ms級反應時間)               | 秒級或更低 (取決於查詢與硬體架構)              |
| 操作型態    | INSERT、UPDATE、DELETE、SELECT | SELECT (JOIN、GROUP BY、聚合)       |

## Row-based? Column-based? 

那看到這你可能就會問了，什麼是 Column-based? Row-based?

### Row-based Storage

:::note
資料是以「整行 (Row)」為單位存放在磁碟上。
:::

* 針對**單筆資料的快速讀取/修改**效率高。
* 適合 OLTP 系統（交易頻繁，資料寫入更新為主）。

假設現在有張表：

| UserID | Name  | Age | Country |
| ------ | ----- | --- | ------- |
| 1      | Alice | 25  | USA     |
| 2      | Bob   | 30  | UK      |

行式存儲會將資料儲存為：

```
[1, Alice, 25, USA] → [2, Bob, 30, UK]
```

每次查詢時會讀取 **整行資料 (所有欄位都會讀取)**，適合查詢條件是基於主鍵查詢 (如 UserID)、資料寫入與更新頻繁（如訂單狀態修改）。

### Column-based Storage

:::note
資料是以「每一欄 (Column)」為單位分開儲存。
:::

* 針對**大規模讀取、聚合查詢 (SUM, AVG, COUNT)** 效率極高。
* 適合 OLAP 系統（讀取大量資料進行分析為主）。

同樣用剛剛的表，列式存儲會將資料儲存為：

```
[1, 2] → [Alice, Bob] → [25, 30] → [USA, UK]
```

若查詢只要 Age 欄位，系統只需讀取 Age 那一列的資料，適合只讀取部分欄位進行統計與分析（如 COUNT, SUM）、大數據批次查詢 (一次查數百萬筆資料)。


## 結語

平時大家小打小鬧的開發大多是使用 OLTP 資料庫，畢竟比較聚焦於即時的 transaction 處理（ACID），我也是因緣際會下才接觸到 TB~PB 等級的資料量，了解到原來還有 OLAP 的存在，下一篇文章我會開始帶其中一種資料庫 - ClickHouse，他便是 OLAP 的一種。