---
title: ClickHouse 系列：Replicated Tables 高可用性與零停機升級實作
published: 2025-08-17
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, 鐵人賽, Distributed]
category: 'software development'
draft: false 
lang: ''
---

在實務中，資料庫節點可能因硬體故障、軟體升級或網路問題而離線。如何確保資料不遺失、查詢不中斷，並且能夠在線進行升級與維護，**高可用性 (High Availability, HA)** 架構成為核心需求。

ClickHouse 提供了 **Replicated Tables** 機制，透過 **主從副本同步（Replication）與自動 Failover 機制**，實現資料一致性與讀取負載平衡，讓叢集具備「零停機升級」的能力。

## 什麼是 Replicated Tables？

Replicated Tables 是 ClickHouse 內建的一種資料複製技術，依賴 **ClickHouse Keeper / ZooKeeper** 作為協調器，實現以下功能：

1. **資料副本同步 (Replication)**：將資料自動複製到多個節點（Replica）。
2. **故障容錯 (Failover)**：當主節點故障時，自動切換至其他 Replica。
3. **讀取負載平衡 (Load Balancing Reads)**：查詢時可自動將請求分散到多個 Replica 節點上。
4. **無鎖定的線上擴容與升級 (Zero Downtime Scaling)**：允許新增副本節點、替換節點而不影響資料可用性。

## Replicated 支援哪些 MergeTree 引擎？

大多數的 MergeTree 家庭成員都支援，包含：
* ReplicatedMergeTree
*	ReplicatedReplacingMergeTree
* ReplicatedSummingMergeTree
* ReplicatedAggregatingMergeTree
* ReplicatedCollapsingMergeTree
* ReplicatedVersionedCollapsingMergeTree
* ReplicatedGraphiteMergeTree

> 這些引擎會在建立表格時透過 `Replicated*MergeTree` 來定義，並指定 ZooKeeper/ClickHouse Keeper 路徑與 Replica 名稱來實現資料副本同步。

## 基本語法

### 1. 建立 ReplicatedReplacingMergeTree

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

### 參數解釋：

上述功能：當同一筆資料出現多個版本時（以 Primary Key 為基準），ClickHouse 會以 ver 欄位數值較大的版本作為最終結果（去重邏輯發生於 Merge 階段）。

> 什麼？忘記了，罰你回去看：[ClickHouse 系列：ReplacingMergeTree 與資料去重機制](https://blog.vicwen.app/posts/clickhouse-replacingmergetree-deduplication/) 🫵

| 參數                                              | 說明                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `/clickhouse/tables/{layer}-{shard}/table_name` | 這是 Zookeeper/ClickHouse Keeper 中的 Metadata 路徑，每個 Replica 會註冊到這個路徑下。 `{layer}` 與 `{shard}` 會從 macros.xml 讀取。 |
| `{replica}`                                     | 代表該節點的 Replica 名稱 (例如 replica1, replica2)，同樣從 macros.xml 讀取。                                         |


### 2. macros.xml 每個節點需設定 shard 與 replica 名稱

```xml
<yandex>
  <macros>
    <shard>01</shard>
    <replica>replica1</replica>
  </macros>
</yandex>
```

每個 Replica 節點都必須設定對應的 `{shard}` 與 `{replica}`，以便在 ZooKeeper/Keeper 上正確標註其節點身份。

## 技術原理與注意事項

### 1. **Replication 是「以資料表為單位」進行，不是以整個伺服器為單位**

* 一台 ClickHouse Server 上可以同時存在 **Replicated Tables** 與 **Non-Replicated Tables**。
* 複製 (Replication) 與分片 (Sharding) 是兩個獨立的概念，Replication 只影響表格副本同步，不影響資料如何分片。

### 2. **Sharding 與 Replication 的獨立性**

* 每個 Shard 之間的資料是獨立的，不會互相複製。
* **Shard 內的副本 (Replica)** 會透過 ReplicatedMergeTree 系列引擎進行同步。
* 分片是「水平切分資料量」，副本是「確保高可用性與故障容錯」。

### 3. **INSERT 與 ALTER 的操作會複製 (同步)**

* **INSERT**：寫入時資料會被同步到同一 Shard 內的所有 Replica 節點。
* **ALTER**：如資料表結構變更 (ADD COLUMN 等)，也會將這些變更同步到 Replica。
* **ALTER 操作支援非阻塞 (non-blocking) 機制**，能夠在線進行不影響線上查詢。

### 4. **CREATE / DROP / ATTACH / DETACH / RENAME 等 DDL 操作不會自動複製**

* **CREATE TABLE**：

  * 在某節點執行 CREATE 時，會在 Keeper/ZooKeeper 註冊為一個新的 Replica。
  * 若其他節點上已存在該表，則會自動建立一個新的 Replica 參與同步。
* **DROP TABLE**：

  * 只會刪除執行該指令的節點上的 Replica，不會影響其他 Replica。
* **ATTACH / DETACH TABLE**：

  * 操作的僅是該節點本機上的表，不會影響其他 Replica。
* **RENAME TABLE**：

  * RENAME 只會影響當前節點的表名稱，Replica 之間的表名可以不同（數據仍同步）。

> **所以 DDL 操作需由開發者自己控制 ON CLUSTER 或手動同步到每個 Replica 節點執行。**

### 5. **Keeper / ZooKeeper 為 Replica Metadata 協調服務**

* Replica 間的同步資訊（例如：目前有哪些 Replica、哪個是 Primary、同步進度、Leader 選舉）都會儲存在 ClickHouse Keeper 或 ZooKeeper 中。
* ClickHouse 官方推薦使用 **ClickHouse Keeper**（ClickHouse 自家實作的輕量版協調器），相較於 ZooKeeper 更輕量穩定。

### 6. **設定 Replication 需要配置 Keeper 區段**

在 ClickHouse 設定檔中 (config.xml)，需定義 ZooKeeper / Keeper 協調器：

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

或者如果使用 ClickHouse Keeper：

```xml
<keeper_server>
    ...
</keeper_server>
```

## 零停機升級 (Zero Downtime Upgrade) 流程

### 升級 Replica 節點步驟：

1. 將待升級節點標記為 **僅讀取流量 (停止寫入該節點)**。
2. 停止該 Replica 節點的 ClickHouse 服務。
3. 升級 ClickHouse 版本，修改配置檔等作業。
4. 重啟節點後，自動從其他副本同步缺失的資料 Part。
5. 節點完成升級並重新加入叢集，恢復寫入與查詢。

### 完整升級叢集時：

* 依序升級 Replica 節點。
* 確保任意時刻至少有一個 Primary 節點與副本處於線上狀態。
* 若需要升級 Shard 節點，應先將流量導向其他 Shard 或 Replica。

## 故障容錯 (Failover) 行為

| 故障場景               | ClickHouse 行為                               |
| ------------------ | ------------------------------------------- |
| Replica (非主節點) 故障  | 該節點不會參與查詢，查詢自動切換至其他 Replica，不影響查詢可用性。       |
| Primary Replica 故障 | 其他 Replica 會透過 Keeper 選舉新的 Primary，確保寫入不中斷。 |
| Keeper 故障 (單節點失效)  | 若為 Keeper 叢集，會自動選擇 Leader，除非多數節點故障才會影響副本同步。 |

## 設計建議

| 設計策略                                       | 說明                                       |
| ------------------------------------------ | ---------------------------------------- |
| 使用奇數數量的 Keeper 節點 (3 或 5 節點)               | 確保故障容忍度達到 n/2，可支撐單點或雙點故障仍維持叢集協調運作。       |
| 分散 Replica 於不同可用區 (AZ)                     | 提升容災能力，確保單一區域失效不會影響整體叢集可用性。              |
| 設定 insert\_quorum=2 以強化寫入一致性               | 可設定 Quorum Write 機制，保證至少 N 個副本成功寫入才返回成功。 |
| 使用 Distributed Table + ReplicatedMergeTree | 確保資料分片與副本同步結合，實現橫向擴展與高可用性並存的架構設計。        |

## ClickHouse Cloud 與自行部署的差異

| 特性                  | ClickHouse Cloud           | 自行部署 ClickHouse                        |
| ------------------- | -------------------------- | -------------------------------------- |
| Replicated Table 建立 | 不需手動設定 Zookeeper，雲端服務自動協調。 | 需自行架設 ClickHouse Keeper / ZooKeeper。   |
| 副本與分片擴容             | 雲端服務可動態擴容，擴容過程對使用者透明。      | 自行部署時需手動加入節點並同步資料。                     |
| 升級與維運               | 由雲端服務自動完成節點升級與容錯。          | 需自行規劃升級排程與 Failover 流程。                |
| 更高控制權 (細部參數調校)      | 雲端部分功能會被封裝起來，無法自訂複雜參數。     | 可完整控制 clusters.xml、macros、Keeper 設定細節。 |

## 進階：運作細節 & 性能影響

### 1. **ZooKeeper/ClickHouse Keeper 是副本協調的基礎**

* 每個 Replicated Table 會在 ZooKeeper/Keeper 上有對應的路徑 (目錄) 來協調副本狀態與同步。
* 若 config.xml 未設定 ZooKeeper/Keeper 連線，則無法建立 Replicated Table，現有的 Replicated Table 也只能讀取，無法寫入。
* 你可以使用同一個 ZooKeeper 叢集管理多個 Shard 的副本協調，但在大型叢集 (300+ 節點) 仍不建議拆分 ZooKeeper 叢集，因為 ClickHouse 預設的協調設計已能有效運作。

### 2. **Replication 不影響 SELECT 查詢效能**

* **讀取查詢 (SELECT)** 時並不會透過 ZooKeeper 進行協調，因此查詢效能與非複製表無異。
* Distributed + Replicated 表查詢時，可透過以下參數控制 Replica 行為：

  | 參數名                                                      | 功能                                        |
  | -------------------------------------------------------- | ----------------------------------------- |
  | max\_replica\_delay\_for\_distributed\_queries           | 設定允許查詢的 Replica 最多可以落後多久（以秒為單位）。          |
  | fallback\_to\_stale\_replicas\_for\_distributed\_queries | 當同步 Replica 不可用時，是否允許回退至資料落後的 Replica 查詢。 |

### 3. **INSERT 會增加 ZooKeeper 的負擔 (約 10 次 Transaction / Data Parts)**

* 每次 INSERT（或每個 Data Parts，預設最大 1,048,576 rows），都會在 ZooKeeper 執行約 10 次 Transaction 來協調副本同步。
* 這會讓 INSERT 相較於非複製表有些微延遲，但若遵循 ClickHouse 的建議（每秒不要超過 1 次 INSERT），在 Production Environment 下並不會造成實際問題。
* **每秒數百次 INSERTs (以 Data Part 計算) 是實務上能穩定支援的規模。**

> 你可能會想說：Vic，每秒不要超過 1 次 INSERT也太弱了吧？

我一開始也是這樣認為，但 ClickHouse 的意思是：「**小批次（小 Data Part）高頻率 INSERT**」的情況。若每秒進行**大量筆數極少（幾百、幾千行）的 INSERT**，會導致每次 INSERT 都需要進行 ZooKeeper 協調、Data Part 的寫入與同步，這會嚴重增加系統負載（ZooKeeper 會被灌爆 Bruh）。

建議還是將資料聚合成「大批次寫入」(例如：1秒寫1次，每次數十萬筆)，降低 Data Part 產生數量，避免 ZooKeeper 壓力。

### 4. **Replication 是非同步且支援 Multi-Master 寫入**

* INSERT 與 ALTER 可發送至任意可用 Replica 節點，資料會寫入本地，然後再同步至其他 Replica。
* 同步是非同步進行的，因此資料在其他副本出現會有些微延遲，這取決於網路傳輸時間與同步處理量。
* 若某些 Replica 暫時離線，當它們重新上線時會自動將缺失的資料補齊。

### 5. **複製只同步原始資料塊，後續合併 (Merge) 是各 Replica 獨立執行的**

* INSERT 時僅會傳送壓縮後的 Data Part 到其他 Replica。
* 合併 (Merge) 操作會由各 Replica 自行執行，但合併的順序與結果會保持一致（由 Keeper 協調）。
* 這種設計大幅降低了網路傳輸量，即使 Replica 分布於跨資料中心 (Cross-DC) 也能高效運作。

### 6. **INSERT 預設僅等待一個 Replica 寫入成功 (非 Quorum Write)**

* 預設情況下，INSERT 只會等其中一個 Replica 確認寫入成功後就返回成功訊號。
* 這意味著若該 Replica 發生永久性故障，該筆資料有遺失風險。
* 若需保障寫入至少多個副本成功才能回應，應啟用：

  ```sql
  SET insert_quorum = 2;
  ```

  這樣只有當至少 2 個 Replica 確認成功寫入才會回傳成功。

### 7. **INSERT 是原子性的、具冪等性且支援去重 (Deduplication)**

* 每個 Data Part 都是以原子性方式寫入。
* 若因網路異常導致客戶端重複發送相同資料，ClickHouse 會自動檢查並去除重複 Data Part（根據資料塊內容與順序）。
* INSERT 操作是冪等的，無論送到哪個 Replica，結果皆一致。

### 8. **背景同步與擷取 (Fetch) 任務可透過參數調校**

| 參數名稱                             | 功能                                                    |
| -------------------------------- | ----------------------------------------------------- |
| background\_schedule\_pool\_size | 控制執行背景合併 (Merge)、壓縮 (Mutations) 等任務的執行緒數量。            |
| background\_fetches\_pool\_size  | 控制 Replicated Table 資料擷取 (Fetch) 任務的執行緒數量，需重啟伺服器才會生效。 |

## 實務建議

| 項目           | 建議                                                |
| ------------ | ------------------------------------------------- |
| INSERT 頻率    | 建議每秒不超過 1 次 INSERT 操作，並將大量資料批次寫入 (Batch Inserts)。 |
| ZooKeeper 負載 | 若 INSERT 頻率極高，可考慮將不同 Shard 使用不同 ZooKeeper 叢集。     |
| 跨資料中心同步      | Replicated Tables 特別適合用於跨資料中心的高可用同步場景。            |
| 一致性要求高的寫入    | 啟用 `insert_quorum` 參數來保障寫入多副本一致性。                 |

## 結語

透過 ClickHouse Replicated Tables 機制，我們能夠實現資料一致性、查詢負載平衡與真正的零停機升級 (Zero Downtime Upgrade)。
對於處理高頻寫入、大規模查詢且又要求高可用性的數據平台，這是不可或缺的核心架構設計。


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
25. [ClickHouse 系列：APM 日誌分析平台架構實作 (Vector + ClickHouse)](https://blog.vicwen.app/posts/clickhouse-apm-log-analytics/)
26. [ClickHouse 系列：IoT 巨量感測數據平台設計實戰](https://blog.vicwen.app/posts/clickhouse-iot-analytics/)
27. [ClickHouse 系列：與 BI 工具整合（Power BI）](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
28. [ClickHouse 系列：ClickHouse Cloud 與自建部署的優劣比較](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
29. [ClickHouse 系列：資料庫安全性與權限管理（RBAC）實作](https://blog.vicwen.app/posts/clickhouse-security-rbac/)

