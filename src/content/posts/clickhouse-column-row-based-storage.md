---
title: ClickHouse 系列：ClickHouse 為什麼選擇 Column-based 儲存？講解 Row-based 與 Column-based 的核心差異
published: 2025-08-05
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database]
category: 'software development'
draft: false 
lang: ''
---

在過去兩篇文章中有提到「Row-based Storage」與「Column-based Storage」是 OLTP 與 OLAP 系統架構選擇的根本差異。本文將從行列存儲的原理出發，說明 ClickHouse 為什麼選擇列式架構，以及它帶來的效能優勢與適用場景。

## 什麼是 Row-based Storage？

Row-based 儲存是將一筆記錄的所有欄位資料「以行為單位」連續存放於磁碟上。也就是說，資料庫每次存取時，會一次性讀取該行的所有欄位資料。

### 優點：

* **適合 OLTP 交易型應用**：例如電商網站的訂單處理、會員登入系統。
* **單筆查詢/修改效率高**：根據主鍵 (Primary Key) 查詢或更新單筆記錄時，能快速取得完整資訊。

### 缺點：

* **批次查詢效率低**：當我們只需查詢「特定欄位」的大量數據時（如報表統計），行式存儲會將整行資料都讀取，造成 I/O 資源浪費。
* **資料壓縮效率差**：由於行內欄位類型與資料分布不一致，壓縮效果有限。

### 代表性資料庫：

MySQL、PostgreSQL、Oracle DB、SQL Server

## 什麼是 Column-based Storage？

Column-based 儲存則是將資料「以欄為單位」儲存在磁碟上。每一個欄位的資料會被獨立且連續地儲存，當查詢時，僅需讀取需要的欄位即可。

### 優點：

* **查詢效能極佳（OLAP 場景）**：例如只需統計使用者年齡分佈時，系統僅讀取 Age 欄位，不需讀取 Name、Address 等無關欄位。
* **壓縮率高**：同一欄位的資料型態一致，重複值多，能進行更有效率的編碼與壓縮（如 Run-Length Encoding、Delta Encoding）。
* **向量化運算加速查詢**：資料欄位緊密排列，使得 CPU 可針對欄位資料進行 SIMD 向量化批次運算，加速查詢執行。

### 缺點：

* **單筆查詢效率低**：若查詢目標是完整一筆記錄，需從多個欄位位置讀取資料並組裝，延遲較高。
* **寫入頻繁場景不適用**：寫入與修改操作成本較高，適合「讀多寫少」的應用情境。

### 代表性資料庫：

ClickHouse、Apache Druid、Amazon Redshift、Google BigQuery

## ClickHouse 為什麼選擇 Column-based？

ClickHouse 作為一個專為 OLAP 場景優化的數據庫，選擇 Column-based 架構是為了解決「大規模資料查詢」時的效能瓶頸。以下是 ClickHouse 透過列式存儲帶來的幾個關鍵優勢：

### 1. 只讀取需要的欄位

在傳統 Row-based 資料庫中，查詢某一欄位的數百萬筆資料時，仍會將整行的其他欄位一起讀取，I/O 浪費嚴重。而 ClickHouse 只需從磁碟讀取查詢所需的欄位，極大幅降低 I/O 操作，查詢延遲也大幅縮短。

### 2. 極致壓縮效能

ClickHouse 內建多種壓縮編碼（LZ4、ZSTD、Gorilla Encoding），並利用 Columnar 儲存的資料重複性，將儲存空間需求降低數倍甚至數十倍。不僅節省儲存成本，亦因資料壓縮而減少 I/O 傳輸量，進一步提升查詢效率。

### 3. 向量化查詢執行

ClickHouse 以向量化 (Vectorized Execution) 為核心，將欄位資料轉換為連續記憶體區塊進行 SIMD 批次處理，使得像 SUM、AVG、COUNT 這類聚合查詢的 CPU 使用率與執行速度都達到極致。

### 4. 與 Data Skipping Indexes 的完美結合

ClickHouse 採用 Data Skipping Indexes（資料跳過索引），當查詢條件不滿足某些資料區塊時，可直接跳過掃描這些無關區塊。這種機制在 Column-based 架構下運作尤為高效，能夠避免全表掃描，讓大規模數據查詢僅需秒級甚至毫秒級回應。

### 5. 更符合 Data Analysis 需求

現代數據分析場景中，查詢行為大多是「大量讀取」與「多欄位聚合」，寫入與修改則相對較少。ClickHouse 透過列式存儲，專注於「讀多寫少」的查詢模式，完美符合數據報表、使用者行為分析、即時數據儀表板等應用場景。

## Row-based 與 Column-based 適用場景總結

| 類型     | Row-based 資料庫           | Column-based 資料庫          |
| ------ | ----------------------- | ------------------------- |
| 典型應用   | OLTP 系統（訂單交易、會員登入）      | OLAP 系統（數據分析、報表、指標監控）     |
| 查詢類型   | 單筆查詢 (主鍵查詢、多次頻繁寫入)      | 批次查詢 (聚合分析、大量讀取特定欄位)      |
| 資料寫入頻率 | 高頻寫入、隨時修改               | 寫入頻率低，以批次/流式匯入為主          |
| 查詢效率   | 單筆查詢延遲低、批次查詢效率差         | 單筆查詢較慢、批次查詢極速             |
| 代表資料庫  | MySQL、PostgreSQL、Oracle | ClickHouse、Druid、Redshift |

## 結語

平時大家小打小鬧的開發大多是使用 OLTP 資料庫，畢竟比較聚焦於即時的 transaction 處理（ACID），我也是因緣際會下才接觸到 TB~PB 等級的資料量，了解到原來還有 OLAP/OLTP/Row-based/Column-based Storage 的存在。

## ClickHouse 系列持續更新中:

1. [ClickHouse 系列：ClickHouse 是什麼？與傳統 OLAP/OLTP 資料庫的差異](https://blog.vicwen.app/posts/what-is-clickhouse/)
2. [ClickHouse 系列：ClickHouse 為什麼選擇 Column-based 儲存？講解 Row-based 與 Column-based 的核心差異](https://blog.vicwen.app/posts/clickhouse-column-row-based-storage/)
3. [ClickHouse 系列：ClickHouse 儲存引擎 - MergeTree](https://blog.vicwen.app/posts/clickhouse-mergetree-engine)