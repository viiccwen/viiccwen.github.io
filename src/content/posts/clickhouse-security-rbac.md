---
title: ClickHouse 系列：資料庫安全性與權限管理（RBAC）實作
published: 2025-08-31
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, 鐵人賽]
category: 'software development'
draft: false 
lang: ''
---

資料庫安全性與權限管理（RBAC, Role-Based Access Control）是不可或缺的基礎設施。ClickHouse 支援細緻的權限設計與 RBAC 機制，能夠確保數據資源的正確隔離與授權，降低操作風險與資安威脅。

## RBAC 架構與核心概念

| 元件            | 說明                                                       |
| ------------- | -------------------------------------------------------- |
| **User**      | 資料庫使用者，可指定密碼、網路存取範圍、預設角色等。                               |
| **Role**      | 角色，承載一組權限（Privilege），可賦予多個使用者。                           |
| **Privilege** | 權限，例如 SELECT、INSERT、ALTER、DROP，可指定作用範圍 (Database/Table)。 |
| **Quota**     | 資源限制，如每分鐘可執行的查詢數、讀取資料量等。                                 |
| **Profile**   | 設定檔，如 max\_memory\_usage、readonly 模式等使用者層級設定。            |

RBAC 設計以 **User → Role → Privilege** 的方式進行權限授予，能讓權限管理變得簡單且可重複使用。


## 啟用 RBAC 與使用者權限管理

1. **啟用 Access Management**

確保 config.xml 中已啟用：

```xml
<access_control>
    <enabled>true</enabled>
</access_control>
```

或使用 Docker 時，指定環境變數：

```yaml
CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: 1
```

2. **建立 User**

```sql
CREATE USER analyst IDENTIFIED WITH plaintext_password BY 'analyst_pass';
```

3. **建立 Role 並授予權限**

```sql
CREATE ROLE analytics_reader;
GRANT SELECT ON default.user_events TO analytics_reader;
```

4. **將 Role 指派給 User**

```sql
GRANT analytics_reader TO analyst;
```

5. **檢查授權結果**

```sql
SHOW GRANTS FOR analyst;
```


## 進階：Profile 與 Quota 設定

1. **建立資源限制 (Quota)**

```sql
CREATE QUOTA daily_quota KEYED BY user_name FOR INTERVAL 1 DAY MAX queries = 1000, errors = 100;
```

2. **建立 Profile（用於參數限制）**

```sql
CREATE SETTINGS PROFILE analyst_profile SETTINGS
    max_memory_usage = 1000000000,
    readonly = 1;
```

3. **將 Quota 與 Profile 指派給 User**

```sql
ALTER USER analyst
    SETTINGS PROFILE analyst_profile
    QUOTA daily_quota;
```


## 模擬登入與權限驗證

1. **使用權限帳號進行查詢**

```bash
clickhouse-client --user=analyst --password=analyst_pass --query="SELECT * FROM default.user_events LIMIT 10"
```

2. **測試未授權操作**

```bash
clickhouse-client --user=analyst --password=analyst_pass --query="DROP TABLE default.user_events"
-- Expected: DB::Exception: analyst: Not enough privileges.
```


## RBAC 實作策略建議

| 情境                    | 實作建議                                 |
| --------------------- | ------------------------------------ |
| 多使用者查詢不同資料表            | 以 Role 將不同表的 SELECT 權限進行組合管理。        |
| 嚴格限制查詢資源消耗            | 使用 Quota 及 Profile 限制記憶體、查詢數量、錯誤次數等。 |
| 只讀帳號/唯讀 API 查詢        | 配置 readonly Profile，禁止寫入/DDL 操作。     |
| 多租戶 (Multi-Tenant) 架構 | 以 Role 與 Database Scope 控制租戶隔離權限。    |


## 結語

ClickHouse 的 RBAC 機制，能夠協助你從「靜態權限管理」升級到「動態可控的使用者行為治理」，不僅能細緻控管資料資源存取權限，還能結合 Quota、Profile 等策略進行資源保護與行為限制，提升系統安全性與穩定性。


### ClickHouse 系列持續更新中:
1. [ClickHouse 系列：ClickHouse 是什麼？與傳統 OLAP/OLTP 資料庫的差異](https://blog.vicwen.app/posts/what-is-clickhouse/)
2. [ClickHouse 系列：ClickHouse 為什麼選擇 Column-based 儲存？講解 Row-based 與 Column-based 的核心差異](https://blog.vicwen.app/posts/clickhouse-column-row-based-storage/)
3. [ClickHouse 系列：ClickHouse 儲存引擎 - MergeTree](https://blog.vicwen.app/posts/clickhouse-mergetree-engine)
4. [ClickHouse 系列：壓縮技術與 Data Skipping Indexes 如何大幅加速查詢](https://blog.vicwen.app/posts/clickhouse-compression-skipping-index/)
5. [ClickHouse 系列：ReplacingMergeTree 與資料去重機制](https://blog.vicwen.app/posts/clickhouse-replacingmergetree-deduplication/)
6. [ClickHouse 系列：SummingMergeTree 進行資料彙總的應用場景](https://blog.vicwen.app/posts/clickhouse-summingmergetree-aggregation/)
7. [ClickHouse 系列：Materialized Views 即時聚合查詢](https://blog.vicwen.app/posts/clickhouse-materialized-view/)
8. [ClickHouse 系列：分區策略與 Partition Pruning 原理解析](https://blog.vicwen.app/posts/clickhouse-partition-pruning/)
9. [ClickHouse 系列：Primary Key、Sorting Key 與 Granule 索引運作原理](https://blog.vicwen.app/posts/clickhouse-primary-sorting-key/)
10. [ClickHouse 系列：CollapsingMergeTree 與邏輯刪除的最佳實踐](https://blog.vicwen.app/posts/clickhouse-collapsingmergetree/)
11. [ClickHouse 系列：VersionedCollapsingMergeTree 版本控制與資料衝突解決](https://blog.vicwen.app/posts/clickhouse-versioned-collapsingmergetree/)
12. [ClickHouse 系列：AggregatingMergeTree 實時指標統計的進階應用](https://blog.vicwen.app/posts/clickhouse-aggregatingmergetree/)
13. [ClickHouse 系列：Distributed Table 與分布式查詢架構](https://blog.vicwen.app/posts/clickhouse-distributed-table-architecture/)
14. [ClickHouse 系列：Replicated Tables 高可用性與零停機升級實作](https://blog.vicwen.app/posts/clickhouse-replication-failover/)
15. [ClickHouse 系列：與 Kafka 整合打造即時 Data Streaming Pipeline](https://blog.vicwen.app/posts/clickhouse-kafka-data-streaming-pipeline/)
16. [ClickHouse 系列：批次匯入最佳實踐 (CSV、Parquet、Native Format)](https://blog.vicwen.app/posts/clickhouse-batch-import/)
17. [ClickHouse 系列：ClickHouse 與外部資料源整合（PostgreSQL）](https://blog.vicwen.app/posts/clickhouse-external-data-integration/)
18. [ClickHouse 系列：如何提升查詢優化？system.query_log 與 EXPLAIN 用法](https://blog.vicwen.app/posts/clickhouse-query-log-explain/)
19. [ClickHouse 系列：Projections 進階查詢加速技術](https://blog.vicwen.app/posts/clickhouse-projections-optimization/)
20. [ClickHouse 系列：Sampling 抽樣查詢與統計技術原理](https://blog.vicwen.app/posts/clickhouse-sampling-statistics/)
21. [ClickHouse 系列：TTL 資料清理與儲存成本優化](https://blog.vicwen.app/posts/clickhouse-ttl-storage-management/)
22. [ClickHouse 系列：儲存政策（Storage Policies）與磁碟資源分層策略](https://blog.vicwen.app/posts/clickhouse-storage-policies/)
23. [ClickHouse 系列：表格設計與儲存優化細節](https://blog.vicwen.app/posts/clickhouse-schemas-storage-improvement/)
24. [ClickHouse 系列：ClickHouse 系列：整合 Grafana 打造可視化監控](https://blog.vicwen.app/posts/clickhouse-grafana-dashboard/)
25. [ClickHouse 系列：查詢優化案例](https://blog.vicwen.app/posts/clickhouse-select-optimization/)
26. [ClickHouse 系列：與 BI 工具整合（Power BI）](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
27. [ClickHouse 系列：ClickHouse Cloud 與自建部署的優劣比較](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
28. [ClickHouse 系列：資料庫安全性與權限管理（RBAC）實作](https://blog.vicwen.app/posts/clickhouse-security-rbac/)
29. [ClickHouse 系列：Kubernetes 部署分散式架構](https://blog.vicwen.app/posts/clickhouse-operator-kubernates/)
30. [ClickHouse 系列：從原始碼看 MergeTree 的七大核心機制](https://blog.vicwen.app/posts/clickhouse-mergetree-sourcecode-introduction/)