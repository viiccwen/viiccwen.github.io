---
title: ClickHouse 系列：從原始碼看 MergeTree 的七大核心機制
published: 2025-09-03
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, 鐵人賽]
category: 'software development'
draft: false 
lang: ''
---

在前 29 天的系列文章中，我們已經從使用者角度理解了 ClickHouse 的表引擎設計：
* 為什麼用列式存儲？
* MergeTree 不使用 B-tree，是如何依靠 min-max 索引做到快速查詢？
* 背景合併、物化檢視、TTL 是如何發揮作用？

今天作為系列收尾篇，我們要從 **開發者角度** 帶大家走進 ClickHouse GitHub 原始碼，探索 MergeTree 的內部結構。

我從茫茫 code 海中挑出了 6 個最重要的模組與函式（我愛 GPT 🤚😭🤚），對應 MergeTree 的「一生」：從**建立 → 插入 → 合併 → 查詢 → 搬移**。

::github{repo="clickhouse/clickhouse"}

本篇建議各位在電腦上看，開兩個視窗分別對應，函數都會特別提醒位置。

## 初始化與格式管理

`MergeTreeData::initializeDirectoriesAndFormatVersion(...)`

該函式在 [src/Storages/MergeTree/MergeTreeData.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeData.cpp#L381)

* 這個函式負責 Table 的資料目錄初始化。
* 功能：
  * 檢查/建立資料目錄
  * 讀取或寫入 `format_version.txt` (寫入至第一個 non-readonly 磁碟中)
  * 檢查是否支援 **custom partitioning**
* 設計：
  * 確保磁碟資料與程式版本相容
  * 若版本過舊，直接丟 Exception 阻止啟動

以下是寫入 `format_version.txt` 的部分程式碼，有解釋到 write once disk 幾乎是等於 read-only（例如 S3 object storage），我們不能寫入在裡面，因為不支援移動或刪除，避免後續 DROP 留下垃圾，造成空間浪費。
```cpp
/// When data path or file not exists, ignore the format_version check
if (!attach || !read_format_version)
{
    format_version = min_format_version;

    /// Try to write to first non-readonly disk
    for (const auto & disk : getStoragePolicy()->getDisks())
    {
        if (disk->isBroken())
            continue;

        /// Write once disk is almost the same as read-only for MergeTree,
        /// since it does not support move, that is required for any
        /// operation over MergeTree, so avoid writing format_version.txt
        /// into it as well, to avoid leaving it after DROP.
        if (!disk->isReadOnly() && !disk->isWriteOnce())
        {
            auto buf = disk->writeFile(format_version_path, 16, WriteMode::Rewrite, getContext()->getWriteSettings());
            writeIntText(format_version.toUnderType(), *buf);
            buf->finalize();
            if (getContext()->getSettingsRef()[Setting::fsync_metadata])
                buf->sync();
        }

        break;
    }
}
else
{
    format_version = *read_format_version;
}
```

> **沒有這一步，後面所有 parts 都無法正確讀寫。**

## Parts 管理 (Immutable data parts)

**代表函式**：

* `MergeTreeData::loadDataParts(...)`
* `MergeTreeData::getDataParts(...)`
* `MergeTreeData::renameTempPartAndReplace(...)`

在 MergeTree 中，**資料不是一張完整的大表，而是一個個 Immutable parts**。

* **啟動時**：`loadDataParts` 掃描磁碟，把所有 parts 載入記憶體索引結構。
* **插入資料**：每次 INSERT 會先生成一個臨時 part，寫完後再 `renameTempPartAndReplace`，正式掛到 parts 目錄。
* **查詢時**：透過 `getDataParts` 取得一致性的 parts 視圖（支援 snapshot 概念）。

> 這就是為什麼 MergeTree 能同時支援 **高效讀取** 與 **高併發寫入**。

### MergeTreeData::loadDataParts

該函式在 [src/Storages/MergeTree/MergeTreeData.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeData.cpp#L2121)

`loadDataParts` 負責：

1. **掃描磁碟** → 找出所有符合 MergeTree part 命名規則的資料目錄。
2. **檢查磁碟合法性** → 確保 parts 不會出現在未定義的 disk 上。
3. **建構 PartLoadingTree** → 把所有 part 整理成樹狀結構（支援包含關係，例如新 part 覆蓋舊 part）。
4. **載入 parts 到記憶體** → 建立 `DataPart` 物件，並加入 `data_parts_indexes`。
5. **處理異常情況** → broken parts、duplicate parts、unexpected parts/outdated parts。
6. **統計與監控** → 用 `ProfileEvents` 記錄載入耗時、載入數量。

#### 檢查 orphaned parts

```cpp
if (!getStoragePolicy()->isDefaultPolicy() && !skip_sanity_checks ...)
{
    // 確保所有 parts 都落在定義的 storage policy 的磁碟上
    // 如果發現 part 在未知磁碟，直接丟 Exception
}
```

> 防止「資料實體還在，但 metadata 已經指不到」，確保資料一致性。

#### 掃描磁碟，收集 parts

```cpp
runner([&expected_parts, &unexpected_disk_parts, &disk_parts, this, disk_ptr]()
{
    for (auto it = disk_ptr->iterateDirectory(relative_data_path); it->isValid(); it->next())
    {
        if (auto part_info = MergeTreePartInfo::tryParsePartName(it->name(), format_version))
        {
            if (expected_parts && !expected_parts->contains(it->name()))
                unexpected_disk_parts.emplace_back(...);
            else
                disk_parts.emplace_back(...);
        }
    }
});
```

* 跳過 `tmp*`、`format_version.txt`、`detached/` 這些特殊目錄。
* 判斷目錄名稱能否 parse 出 `MergeTreePartInfo`（不符合規則就當垃圾忽略）。
* 把 parts 分為 **預期內**（正常）與 **unexpected**（意外找到的）。

#### 建立 PartLoadingTree

```cpp
auto loading_tree = PartLoadingTree::build(std::move(parts_to_load));
```

* parts 之間可能有「包含」關係（例如新 part 覆蓋了老 part 的範圍）。
* PartLoadingTree 幫助找出「最上層、最完整」的 parts 作為 active parts。

#### 載入 active parts

```cpp
auto loaded_parts = loadDataPartsFromDisk(active_parts);
```

對於每個 active part：
* 檢查是否 broken（檔案缺失、壓縮錯誤等）
* 檢查是否 duplicate
* 判斷 index granularity（adaptive vs non-adaptive）
* 記錄是否帶有 lightweight delete、transaction metadata

> 這裡是把磁碟上的目錄轉換為 `DataPart` 物件的關鍵。

#### 處理異常情況

* **broken parts**：移動到 `detached/broken-on-start/` 目錄
* **duplicate parts**：刪除（除非 static storage）
* **unexpected parts**：記錄下來，開 background task 去處理
* **outdated parts**：同樣丟到 background task async 載入

#### 防呆檢查

```cpp
if (have_non_adaptive_parts && have_adaptive_parts && !enable_mixed_granularity_parts)
    throw Exception(...);
```

> 如果表裡同時有 **舊的非 adaptive granularity parts** 和 **新的 adaptive parts**，預設是不允許混用的（除非開 `enable_mixed_granularity_parts` 設定）。

#### 紀錄監控 & 任務註冊

```cpp
LOG_DEBUG(log, "Loaded data parts ({} items) took {} seconds", data_parts_indexes.size(), watch.elapsedSeconds());
ProfileEvents::increment(ProfileEvents::LoadedDataParts, data_parts_indexes.size());
```

* 用 log 與 ProfileEvents 記錄 parts 載入耗時與數量。
* 如果 disk 全是 Readonly（例如所有磁碟都是 cold storage），會啟動一個定期 refresh parts 的任務。

### MergeTreeData::getDataParts

該函式在 [src/Storages/MergeTree/MergeTreeData.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeData.cpp#L7640)

這個函式很短，它主要是**查詢要讀哪些 parts，就是從這裡開始決定的**。

```cpp
MergeTreeData::DataParts MergeTreeData::getDataParts(
    const DataPartStates & affordable_states,
    const DataPartsKinds & affordable_kinds) const
```

* **輸入參數**
  * `affordable_states`：允許的 part 狀態（active、outdated、temporary…）
  * `affordable_kinds`：允許的 part 類型（wide、compact、in-memory…）
* **回傳值**
  * 一個 `DataParts` 容器，包含目前符合條件的 parts。

```cpp
auto lock = lockParts();
```

* 加鎖，確保 `data_parts_indexes` 不會在迭代 (iteration) 時被修改。
* 因為 parts 可能同時被 background merge/mutation 移動。

```cpp
for (auto state : affordable_states)
{
    for (auto kind : affordable_kinds)
    {
        auto range = getDataPartsStateRange(state, kind);
        res.insert(range.begin(), range.end());
    }
}
```

* 雙層迴圈，對每個 `(state, kind)` 配對，從內部索引拿出符合條件的 parts range。
* `getDataPartsStateRange(state, kind)` → 回傳一個 iterator 範圍，代表目前符合條件的 parts。
* 把這些 parts 全部收集到 `res`。

### MergeTreeData::renameTempPartAndReplace

該函式在 [src/Storages/MergeTree/MergeTreeData.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeData.cpp#L4810)

這個函式主要是 **INSERT 進 MergeTree流程的收尾**

```cpp
MergeTreeData::DataPartsVector MergeTreeData::renameTempPartAndReplace(
    MutableDataPartPtr & part,
    Transaction & out_transaction,
    bool rename_in_transaction)
```

* **輸入參數**
  * `part`：剛寫好的 **臨時 part (tmp\_xxx)**
  * `out_transaction`：事務物件，用來確保替換 parts 的操作原子性
  * `rename_in_transaction`：是否在事務中完成 rename（可選擇延遲到 commit）
* **回傳值**
  * `covered_parts`：被新 part 覆蓋、取代的舊 parts（例如 overlapped 的小 part）。

```cpp
auto part_lock = lockParts();
```

* 對 `parts` 容器加鎖，確保替換過程 thread-safe。
* 因為同一時間可能有 background merge/mutation 在動 parts。

```cpp
renameTempPartAndReplaceImpl(part, out_transaction, part_lock, &covered_parts, rename_in_transaction);
```

* 核心邏輯在 `renameTempPartAndReplaceImpl`：
  1. 把 `tmp_xxx` 的 part 實際 **rename 成正式名稱**（例如 `all_1_1_0`）。
  2. 更新 `data_parts_indexes`，把這個新 part 插入。
  3. 找出與它重疊的舊 parts，把它們標記為過時（outdated）或直接移除。
  4. 若開啟 `rename_in_transaction`，則這些更新會在 transaction commit 時一次性生效。

```cpp
return covered_parts;
```

> 把被覆蓋的舊 parts 傳回給呼叫端（方便後續處理，例如 detach 或刪除）。

#### INSERT 流程

1. 使用者做一個 `INSERT INTO table VALUES (...)`
2. ClickHouse 把資料寫成一個 **臨時 part**（名字以 `tmp_` 開頭），確保寫入中途崩潰不會污染active parts。
3. 寫完後呼叫 `renameTempPartAndReplace(...)`：
   * 把 `tmp_xxx` rename 成正式 part 名稱
   * 更新 in-memory 索引結構
   * 移除被它覆蓋的舊 parts
4. INSERT commit 成功 → 新 part 對查詢可見

可以達到以下的功能
1. **Temp file Protection**：
   * 所有 INSERT 都先寫成 `tmp_` part，只有最後 rename 成功才「生效」，確保 Atomicity。
2. **Optimistic Merge**：
   * 插入新 part 時順便覆蓋舊的 overlapped parts，避免資料重疊，保持狀態乾淨。
3. **Transaction Consistency**：
   * 如果用 `rename_in_transaction`，就能確保多個操作同時 commit 或 rollback ，支持更複雜的 ALTER/REPLACE 操作。


## 合併 (Background Merge / Compaction)

**代表函式**：
* `MergeTreeDataMergerMutator::mergePartsToTemporaryPart(...)`
* `MergeTreeBackgroundExecutor<Queue>::trySchedule(...)`
* `MergeTask::execute(...)`

MergeTree 的核心是「**不做更新，只新增 part，後台再合併**」。

* Insert 會產生許多小 parts。
* 背景任務 (`tryScheduleMerge`) 會挑選多個小 part，呼叫 `mergePartsToTemporaryPart` 合併成一個大 part。
* 合併過程會同時應用 TTL、壓縮策略，最終釋放磁碟與加速查詢。

> **這就是 ClickHouse 可以維持高寫入速度的祕密：寫入快 → 在背景自行慢慢整理。**

### MergeTreeBackgroundExecutor<Queue>::trySchedule

該函式在 [src/Storages/MergeTree/MergeTreeBackgroundExecutor.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeBackgroundExecutor.cpp#L140)

這個函數是 **MergeTree 合併/後台任務排程的入口**

```cpp
template <class Queue>
bool MergeTreeBackgroundExecutor<Queue>::trySchedule(ExecutableTaskPtr task)
```

* **作用**：嘗試把一個後台任務（例如 merge、mutation、TTL clean）放進執行 queue 裡面。
* **回傳**：
  * `true` → 成功排程
  * `false` → 被拒絕（可能是系統 shutdown 或 queue 已滿）

#### 鎖保護

```cpp
std::lock_guard lock(mutex);
```
保護 `pending` 任務隊列，避免多執行緒同時修改。

#### 檢查當前任務數量是否超限

```cpp
auto & value = CurrentMetrics::values[metric];
if (value.load() >= static_cast<int64_t>(max_tasks_count))
    return false;
```

* 透過 `CurrentMetrics` 監控目前這個 executor 的 task 數量。
* 如果超過 `max_tasks_count`（例如限制同時執行的合併數量），就拒絕排程。

#### 把任務放進 queue 中

```cpp
pending.push(std::make_shared<TaskRuntimeData>(std::move(task), metric));
```

* 把傳入的 `task` 包裝成 `TaskRuntimeData` 放入 `pending` queue。
* `TaskRuntimeData` 附帶 metric，用來追蹤這個 task 的執行狀態。

#### 通知 worker thread

```cpp
has_tasks.notify_one();
```

* 喚醒一個等待中的 worker thread，讓它開始處理任務。

#### 整理

這個函式做了**非阻塞調度**、**資源控制**、**監控** 等作用，避免同時合併過多 parts，導致磁碟 I/O 打爆、所有任務數量都掛在 `CurrentMetrics` 上，方便監控系統看到目前 Merge/Mutation 壓力


### MergeTreeDataMergerMutator::mergePartsToTemporaryPart

該函式在 [src/Storages/MergeTree/MergeTreeDataMergerMutator.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeDataMergerMutator.cpp#L557)

這函數是 **MergeTree 合併的入口**。我們來一步步拆解：

* **用途**：建立一個 `MergeTask`，它代表一次「合併（merge）或變更（mutation）」的任務。
* **位置**：`src/Storages/MergeTree/MergeTreeDataMergerMutator.cpp`
* **回傳值**：`MergeTaskPtr`（指向新建的 `MergeTask`）

**注意**：這裡只是「構造 MergeTask」，真正的合併邏輯會在 `MergeTask::execute()` 裡跑。

#### 參數
```cpp
FutureMergedMutatedPartPtr future_part,
StorageMetadataPtr metadata_snapshot,
MergeList::Entry * merge_entry,
std::unique_ptr<MergeListElement> projection_merge_list_element,
TableLockHolder & holder,
time_t time_of_merge,
ContextPtr context,
ReservationSharedPtr space_reservation,
bool deduplicate,
const Names & deduplicate_by_columns,
bool cleanup,
MergeTreeData::MergingParams merging_params,
MergeTreeTransactionPtr txn,
bool need_prefix,
IMergeTreeDataPart * parent_part,
const String & suffix
```

* **`future_part`**
  * 將要產生的新 part（描述來源 parts 與輸出名稱）。
  * 是合併計畫的 blueprint。
* **`metadata_snapshot`**
  * 表的 metadata 快照，包含欄位定義、索引、TTL 等資訊。
* **`merge_entry / projection_merge_list_element`**
  * 追蹤 merge 在 `system.merges`（或 `system.part_log`）的紀錄，方便監控。
* **`holder`**
  * 表鎖，保證合併過程不與 DDL 衝突。
* **`space_reservation`**
  * 磁碟空間預留，確保合併過程不會因空間不足失敗。
* **`deduplicate / deduplicate_by_columns`**
  * 是否需要做去重（適用於 `ReplacingMergeTree`、`OPTIMIZE TABLE ... DEDUPLICATE`）。
* **`cleanup`**
  * 是否在合併時執行清理（例如 TTL）。
* **`merging_params`**
  * MergeTree 的合併參數（普通、Collapsing、VersionedCollapsing、Summing、Aggregating 等）。
* **`txn`**
  * 與 transaction 結合，支援多語句 Transaction 或 MVCC。
* **`need_prefix / parent_part / suffix`**
  * 控制新 part 的命名方式，特別是在 mutation、projection merge 的情境下。

#### 判斷式

```cpp
if (future_part->isResultPatch())
{
    merging_params = MergeTreeData::getMergingParamsForPatchParts();
    metadata_snapshot = future_part->parts.front()->getMetadataSnapshot();
}
```

* 如果這是一個 **patch merge**（例如 mutation 補丁），就調整 merging\_params，並從來源 part 重新抓 metadata。

#### 回傳值

```cpp
return std::make_shared<MergeTask>(...);
```

* 最後建立 `MergeTask`，包含所有合併需要的上下文：
  * 要合併哪些 parts (`future_part`)
  * 怎麼合併（`merging_params`、`deduplicate`、`cleanup`）
  * 合併過程需要的資源（`space_reservation`、`holder`）
  * log tracing（`merge_entry`、`projection_merge_list_element`）

> **之後 background thread pool 會呼叫 `MergeTask::execute()`，真正讀取來源 parts → 做合併 → 輸出新 part。**

所以 `mergePartsToTemporaryPart(...)` 的角色：

1. **不是直接合併資料**，而是 **建立一個 MergeTask**。
2. MergeTask 帶齊所有 context：parts、metadata、transaction、磁碟空間、dedup、TTL、log。
3. Background Executor 會排程並執行這個 MergeTask，最後產生新的 **臨時 part**。
4. 臨時 part 成功後，透過 `renameTempPartAndReplace(...)` 變成正式 part。


### MergeTask::execute(...)

該函式在 [src/Storages/MergeTree/MergeTask.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTask.cpp#L1590)

這個函數就是 **MergeTree 真正執行合併的核心函數**

* 代表一次 **合併（merge）或 mutation** 任務的執行邏輯。
* **特點**：合併不是一次性做完，而是拆成 **多個 Stage（階段）**，逐步執行。
* 回傳值：
  * `true` → 還有後續 Stage 未完成（task 還需要繼續跑）
  * `false` → 所有 Stage 都完成，合併結束

#### 取出當前階段

```cpp
chassert(stages_iterator != stages.end());
const auto & current_stage = *stages_iterator;
```

* `MergeTask` 持有一個 `stages` 向量（pipeline 概念）。
* `stages_iterator` 指向當前要執行的 Stage。

#### 嘗試執行當前 Stage

```cpp
if (current_stage->execute())
    return true;
```

* 如果當前 Stage 還沒做完，回傳 `true` → 表示下次還要繼續跑這個 Stage。
* 注意：Stage 本身可能是耗時操作（例如讀取、壓縮、寫入），會分批執行。

#### Stage 結束 → 記錄耗時

```cpp
UInt64 current_elapsed_ms = global_ctx->merge_list_element_ptr->watch.elapsedMilliseconds();
UInt64 stage_elapsed_ms = current_elapsed_ms - global_ctx->prev_elapsed_ms;
global_ctx->prev_elapsed_ms = current_elapsed_ms;
```

* 記錄從上次到現在為止的時間差 = 本階段耗時。
* `global_ctx` 是 merge 任務的全域上下文，裡面有 ProfileEvents 追蹤器。

#### 更新 ProfileEvents

```cpp
if (global_ctx->parent_part == nullptr)
{
    ProfileEvents::increment(current_stage->getTotalTimeProfileEvent(), stage_elapsed_ms);
    ProfileEvents::increment(ProfileEvents::MergeTotalMilliseconds, stage_elapsed_ms);
}
```

* 如果不是 projection 合併，更新總耗時統計。
* 每個 Stage 都有對應的 ProfileEvent，例如 `MergeReadBlocks`、`MergeWriteBlocks`。

#### 移動到下一個 Stage

```cpp
++stages_iterator;
if (stages_iterator == stages.end())
    return false;
```

* 移動迭代器，進入下一階段。
* 如果已經到 `stages.end()` → 合併全部完成，回傳 `false`。

#### 初始化下一個 Stage

```cpp
(*stages_iterator)->setRuntimeContext(std::move(next_stage_context), global_ctx);
return true;
```

* 把上一個 Stage 的輸出 context 傳給下一個 Stage（類似 pipeline）。
* 回傳 `true` → 表示還有 Stage 要跑。

#### 例外處理

```cpp
catch (...)
{
    merge_failures.withLabels({String(ErrorCodes::getName(getCurrentExceptionCode()))}).increment();
    throw;
}
```

* 如果合併失敗（I/O 錯誤、磁碟滿、資料壞掉），紀錄失敗次數並拋出 Exception。
* `merge_failures` 是一個 metrics counter，用來統計失敗的類型。


## 查詢讀取 (Query Read Path)

**代表函式**：

* [`MergeTreeDataSelectExecutor::read(...)`](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeDataSelectExecutor.cpp#L173)
* [`MergeTreeDataSelectExecutor::readFromParts(...)`](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeDataSelectExecutor.cpp#L1283)

當使用者執行 `SELECT`，查詢流程會進入 `MergeTreeDataSelectExecutor::read`：

1. 選出符合分區的 parts
2. 透過索引裁剪 granules（例如 min-max index）
3. 呼叫 `readFromParts` 讀取真正需要的資料塊
4. 將資料送入 QueryPlan pipeline（Filter、Join、Aggregate、Sort 等）

```cpp
const auto & snapshot_data = assert_cast<const MergeTreeData::SnapshotData &>(*storage_snapshot->data);
```

* 每次查詢都有一個 `StorageSnapshot`，裡面包含表當前可見的 parts 與 mutation snapshot。
* `snapshot_data.parts` → 這次查詢要讀的 parts（已經裁剪過的 active parts）
* `snapshot_data.mutations_snapshot` → 確保查詢在一個一致性版本上執行。

```cpp
auto step = readFromParts(
    snapshot_data.parts,
    snapshot_data.mutations_snapshot,
    column_names_to_return,
    storage_snapshot,
    query_info,
    context,
    max_block_size,
    num_streams,
    max_block_numbers_to_read,
    /*merge_tree_select_result_ptr=*/ nullptr,
    enable_parallel_reading);
```

* **輸入參數**：
  * `parts` → 要讀的資料分片
  * `mutations_snapshot` → 保證一致性
  * `column_names_to_return` → 只讀需要的欄位
  * `query_info` → 包含 WHERE、ORDER BY、LIMIT 等查詢條件
  * `max_block_size` → 每個 Block 的最大行數（控制批次大小）
  * `num_streams` → 幾個執行緒並行讀
  * `enable_parallel_reading` → 是否允許副本平行讀

* **回傳值**：
  * `step` → 一個 QueryPlanStep (`ReadFromMergeTree`)，代表「如何從 MergeTree parts 讀資料」。

```cpp
auto plan = std::make_unique<QueryPlan>();
if (step)
    plan->addStep(std::move(step));
return plan;
```

* 建立空的 `QueryPlan`。
* 如果成功得到一個讀取 Step，就把它加進 plan 裡。
* 最後回傳完整的 QueryPlan，交給 pipeline 去執行。

## 索引與過濾 (Index & Skipping)

**代表函式**：

* `MergeTreeWhereOptimizer::optimize(...)`

查詢過程中，ClickHouse 不會「全表掃描」，而是依靠索引：

* **主鍵索引**（排序後的 min-max 範圍）
* **Data Skipping Index**（布隆過濾器、Set index、Token index）

`MergeTreeWhereOptimizer::optimize` 負責重寫 WHERE 條件，盡量利用索引過濾掉無效 granules，讓查詢只掃必要的資料。

該函式在 [src/Storages/MergeTree/MergeTreeWhereOptimizer.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeWhereOptimizer.cpp#L104C1-L142C2)

這個函式是在分析 `SELECT ... WHERE ...` 條件，決定哪些可以下推到 **PREWHERE**，然後改寫 AST，把部分條件移到 `PREWHERE`

PREWHERE 的特點：
* **先讀部分列，過濾掉大部分資料後，再讀剩下需要的列**
* 對 columnar storage 的查詢效率特別有用

```cpp
if (!select.where() || select.prewhere())
    return;
```

* 如果查詢沒有 WHERE，或已經有 PREWHERE，就不用優化。

```cpp
auto block_with_constants = KeyCondition::getBlockWithConstants(...);
```

* 取得查詢裡的常量（方便條件下推）。

```cpp
WhereOptimizerContext where_optimizer_context;
where_optimizer_context.context = context;
where_optimizer_context.array_joined_names = determineArrayJoinedNames(select);
where_optimizer_context.move_all_conditions_to_prewhere = context->getSettingsRef()[Setting::move_all_conditions_to_prewhere];
...
```

* 準備優化器需要的上下文，包括：

  * 是否強制把所有條件移到 PREWHERE
  * 是否允許重新排序條件
  * 是否使用統計資料
  * 查詢是否帶 `FINAL`（可能會影響可下推性）

```cpp
RPNBuilderTreeContext tree_context(context, std::move(block_with_constants), {});
RPNBuilderTreeNode node(select.where().get(), tree_context);
auto optimize_result = optimizeImpl(node, where_optimizer_context);
```

* 把 WHERE 條件解析成 **布林運算樹 (RPN – Reverse Polish Notation)**。
* 呼叫 `optimizeImpl`，嘗試把合適的條件下推。
* 回傳結果包含：

  * `where_conditions`（留下的 WHERE 條件）
  * `prewhere_conditions`（被搬移的條件）

```cpp
auto where_filter_ast = reconstructAST(optimize_result->where_conditions);
auto prewhere_filter_ast = reconstructAST(optimize_result->prewhere_conditions);

select.setExpression(ASTSelectQuery::Expression::WHERE, std::move(where_filter_ast));
select.setExpression(ASTSelectQuery::Expression::PREWHERE, std::move(prewhere_filter_ast));
```

* 把結果重新組裝回 AST（抽象語法樹）。
* SELECT 查詢此時變成：

  ```sql
  SELECT ...
  PREWHERE <部分條件>
  WHERE <剩餘條件>
  ```

```cpp
LOG_DEBUG(
    log,
    "MergeTreeWhereOptimizer: condition \"{}\" moved to PREWHERE",
    select.prewhere()->formatForLogging(...));
```

* 做 log 記錄搬移後的 PREWHERE 條件。

> **這是從「數十億行」中秒級查詢的關鍵。**

## TTL 與資料搬移

**代表函式**：

* `MergeTreeData::moveParts(...)`
* `MergeTreeData::removeOutdatedPartsAndDirs(...)`

MergeTree 支援 TTL（Time-to-Live），讓資料自動過期或搬移：

* **舊資料刪除** → `removeOutdatedPartsAndDirs` 清理過期 parts
* **冷熱數據分層** → `moveParts` 把舊資料搬到慢速磁碟（HDD、S3），新資料留在 SSD

> **這讓 MergeTree 不只是 OLAP 表，還能做到資料生命週期管理 (Data Lifecycle Management)。**

### `MergeTreeData::moveParts(...)`

該函式在 [src/Storages/MergeTree/MergeTreeWhereOptimizer.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeWhereOptimizer.cpp#L104C1-L142C2)

會根據 StoragePolicy（例如多磁碟策略：SSD → HDD，或節省空間）將 parts 實際移動到不同磁碟。

```cpp
LOG_INFO(log, "Got {} parts to move.", moving_tagger->parts_to_move.size());
MovePartsOutcome result{MovePartsOutcome::PartsMoved};
```

記錄這次要搬多少個 parts，初始假設結果是成功移動。

```cpp
for (const auto & moving_part : moving_tagger->parts_to_move)
```

每個 part 都要嘗試 clone（複製）並替換。

```cpp
auto moves_list_entry = getContext()->getMovesList().insert(...);
```

更新系統表 `system.moves`，讓使用者可觀察目前有哪些 parts 正在被移動。

```cpp
if (supportsReplication() && disk->supportZeroCopyReplication() && (*settings)[MergeTreeSetting::allow_remote_fs_zero_copy_replication])
```

如果表是 ReplicatedMergeTree 且啟用零拷貝複製：
  * 多個 replica **不能同時移動同一個 part**，否則會產生多份副本。
  * 使用 **ZooKeeper/keeper 的 zero-copy lock** 來互斥。

```cpp
auto lock = tryCreateZeroCopyExclusiveLock(moving_part.part->name, disk);
if (!lock)
{
    result = MovePartsOutcome::MoveWasPostponedBecauseOfZeroCopy;
    break;
}
```

如果沒拿到 lock，就 postpon，避免競爭。

```cpp
cloned_part = parts_mover.clonePart(moving_part, read_settings, write_settings);
if (lock->isLocked())
    parts_mover.swapClonedPart(cloned_part);
```

* 如果 lock 仍有效 → clone part，然後替換。
* 如果 lock 在 clone 過程失效 → 延後處理（retry）。

```cpp
cloned_part = parts_mover.clonePart(moving_part, read_settings, write_settings);
parts_mover.swapClonedPart(cloned_part);
```

直接 clone → swap，完成 part 移動。


```cpp
write_part_log({});
```

寫入 `system.part_log`，紀錄這次 MOVE\_PART 操作，包含耗時、來源/目的磁碟等資訊。


```cpp
catch (...)
{
    write_part_log(ExecutionStatus::fromCurrentException("", true));
    throw;
}
```

如果移動過程失敗，紀錄錯誤並重新拋出例外。

## 結語

終於這系列迎來了一個結束，跟我的暑期實習一起畢業了 XD（沒啦，開學後還會繼續做），希望各位喜歡這系列文章。

之前有人問我：「Vic，你為什麼想開始鐵人賽」。當初覺得透過鐵人賽壓力讓自己快速深入一個服務，而且查閱了市面上很少人做 ClickHouse 相關的文章，就算有也只是講應用居多，我可以說是第一個開始提及底層原理和架構，可能客群都是資料科學家，很少我這種後端工程師會專注於這個）？

ClickHouse 是個很讓人著迷的 TB\~PB 級別資料處理神器，前提是具備良好的基礎知識，才能在建表的時候考慮到所有情況。透過正確的根據業務邏輯、資料型別採取對應建表策略。

像是我在這次實習當中，替公司從雲上搬遷了資料，原本在 PostgreSQL 上單個表有約 **400GB**，但是使用 ClickHouse 搭配正確的配置策略，我可以將**壓縮比達到 5x~86x** 左右（依照欄位資料型別而定），替公司單一表格省下了**約 360GB** 的儲存成本，並且提高查詢效率，有助於公司內部資料分析、自動化效率。

這一系列文章也側面驗證了：**為什麼 ClickHouse 能同時承受高寫入與大規模查詢，並在業界成為主流 OLAP 資料庫服務**。


### ClickHouse 系列~~持續更新中~~ 完結啦:

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