---
title: ClickHouse 系列：Replicated Tables 高可用性與零停機升級實作
published: 2025-08-19
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, Distributed]
category: 'software development'
draft: true 
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

## Replicated Tables 的基本語法

### 1. 建立 ReplicatedMergeTree 表

```sql
CREATE TABLE default.replicated_visits
(
    Date Date,
    UserID UInt64,
    PageViews UInt32
) ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/visits', '{replica}')
ORDER BY (Date, UserID);
```

### 參數解釋：

| 參數                                  | 說明                                                        |
| ----------------------------------- | --------------------------------------------------------- |
| `/clickhouse/tables/{shard}/visits` | 這是 ZooKeeper/Keeper 中的路徑，該 Table 的所有副本會在這個路徑下協調同步。        |
| `{replica}`                         | 由每個節點的 macros.xml 提供 (如 replica1、replica2)。               |
| MergeTree 儲存引擎特性                    | 繼承 MergeTree 的所有功能，如 Primary Key、Partition、Data Skipping。 |

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

## Replication 的核心原理

1. **所有寫入操作都會進入 Primary Replica（Leader）**，並透過 Keeper 同步到其他副本 (Follower)。
2. **查詢時可從任意 Replica 讀取資料**，ClickHouse 會根據負載自動選擇最合適的節點（也可手動指定）。
3. 若 Primary 發生故障，Replica 會自動進行 Leader 重新選舉，確保寫入不中斷。
4. 新增節點作為 Replica 時，ClickHouse 會自動從現有副本進行完整資料同步，無需停機。

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

## 設計建議與實務經驗

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

## 結語

透過 ClickHouse Replicated Tables 機制，我們能夠實現資料一致性、查詢負載平衡與真正的零停機升級 (Zero Downtime Upgrade)。
對於處理高頻寫入、大規模查詢且又要求高可用性的數據平台，這是不可或缺的核心架構設計。