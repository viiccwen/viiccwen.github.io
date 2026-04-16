---
title: "ClickHouse Series: Six Core MergeTree Mechanisms from the Source Code"
published: 2025-09-03
description: ""
image: "https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress"
tags: ["ClickHouse", "Database", "Ironman"]
category: "software development"
draft: false
lang: "en"
---

Over the previous 29 days of this series, we have already understood ClickHouse table engine design from the user's perspective:
* Why use columnar storage?
* How does MergeTree avoid B-trees and still achieve fast queries with a min-max index?
* How do background merges, materialized views, and TTL work?

Today, as the closing article of the series, we are going to step into the ClickHouse GitHub source code from the **developer's perspective** and explore the internal structure of MergeTree.

I picked six of the most important modules and functions from the vast sea of code (I love GPT 🤚😭🤚), corresponding to the "life cycle" of MergeTree: **create -> insert -> merge -> query -> move**.

::github{repo="clickhouse/clickhouse"}

This article is best read on a computer with two windows open side by side. I will point out the exact function locations along the way.

## Initialization and Format Management

`MergeTreeData::initializeDirectoriesAndFormatVersion(...)`

This function lives in [src/Storages/MergeTree/MergeTreeData.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeData.cpp#L381)

* It initializes the table's data directories.
* Responsibilities:
  * Check or create the data directory
  * Read or write `format_version.txt` on the first non-read-only disk
  * Check whether **custom partitioning** is supported
* Design:
  * Ensure disk data is compatible with the program version
  * If the version is too old, throw an exception and refuse to start

The following code writes `format_version.txt`. The comments explain that write-once disks are almost the same as read-only disks, such as S3 object storage. We cannot write there because they do not support move or delete operations. That would leave garbage behind after DROP and waste space.

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

> Without this step, none of the later parts can be read or written correctly.

## Parts Management (Immutable Data Parts)

**Representative functions**:

* `MergeTreeData::loadDataParts(...)`
* `MergeTreeData::getDataParts(...)`
* `MergeTreeData::renameTempPartAndReplace(...)`

In MergeTree, **data is not stored as one giant table, but as a set of immutable parts**.

* **On startup**: `loadDataParts` scans the disk and loads all parts into an in-memory index structure.
* **When inserting data**: each INSERT first creates a temporary part, then after the write completes it calls `renameTempPartAndReplace` to attach the part formally under the parts directory.
* **When querying**: `getDataParts` returns a consistent view of the parts, with snapshot-like behavior.

> This is why MergeTree can support both **fast reads** and **high-concurrency writes**.

### MergeTreeData::loadDataParts

This function lives in [src/Storages/MergeTree/MergeTreeData.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeData.cpp#L2121)

`loadDataParts` is responsible for:

1. **Scanning disks** -> finding all data directories that match the MergeTree part naming rules
2. **Checking disk validity** -> making sure parts do not appear on undefined disks
3. **Building a PartLoadingTree** -> organizing all parts into a tree structure that supports containment relationships, such as new parts covering old parts
4. **Loading parts into memory** -> creating `DataPart` objects and adding them to `data_parts_indexes`
5. **Handling abnormal cases** -> broken parts, duplicate parts, unexpected parts, and outdated parts
6. **Statistics and monitoring** -> recording load time and load count with `ProfileEvents`

#### Checking orphaned parts

```cpp
if (!getStoragePolicy()->isDefaultPolicy() && !skip_sanity_checks ...)
{
    // Make sure all parts are stored on disks defined by the storage policy
    // If a part is found on an unknown disk, throw an exception immediately
}
```

> This prevents the situation where the data files are still there but the metadata can no longer point to them, keeping data consistency intact.

#### Scanning disks and collecting parts

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

* Skip special directories such as `tmp*`, `format_version.txt`, and `detached/`.
* Check whether a directory name can be parsed into `MergeTreePartInfo`. If not, treat it as garbage and ignore it.
* Split parts into **expected** ones and **unexpected** ones.

#### Building the PartLoadingTree

```cpp
auto loading_tree = PartLoadingTree::build(std::move(parts_to_load));
```

* Parts may have containment relationships, such as a new part covering the range of an older part.
* PartLoadingTree helps identify the top-most, most complete parts as active parts.

#### Loading active parts

```cpp
auto loaded_parts = loadDataPartsFromDisk(active_parts);
```

For each active part:
* Check whether it is broken, for example due to missing files or compression errors
* Check for duplicates
* Determine the index granularity, adaptive or non-adaptive
* Record whether it carries lightweight deletes or transaction metadata

> This is the key step that turns on-disk directories into `DataPart` objects.

#### Handling abnormal cases

* **Broken parts**: move them to the `detached/broken-on-start/` directory
* **Duplicate parts**: delete them, unless the storage is static
* **Unexpected parts**: record them and spawn a background task to handle them
* **Outdated parts**: also load them asynchronously through a background task

#### Defensive check

```cpp
if (have_non_adaptive_parts && have_adaptive_parts && !enable_mixed_granularity_parts)
    throw Exception(...);
```

> If a table contains both **older non-adaptive granularity parts** and **newer adaptive parts**, mixing them is not allowed by default unless `enable_mixed_granularity_parts` is enabled.

#### Monitoring and task registration

```cpp
LOG_DEBUG(log, "Loaded data parts ({} items) took {} seconds", data_parts_indexes.size(), watch.elapsedSeconds());
ProfileEvents::increment(ProfileEvents::LoadedDataParts, data_parts_indexes.size());
```

* Use logs and `ProfileEvents` to record how long part loading takes and how many parts were loaded.
* If all disks are read-only, such as when everything is on cold storage, a periodic refresh task is started.

### MergeTreeData::getDataParts

This function lives in [src/Storages/MergeTree/MergeTreeData.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeData.cpp#L7640)

This function is short. It mainly decides **which parts should be read during a query**.

```cpp
MergeTreeData::DataParts MergeTreeData::getDataParts(
    const DataPartStates & affordable_states,
    const DataPartsKinds & affordable_kinds) const
```

* **Input parameters**
  * `affordable_states`: allowed part states, such as active, outdated, temporary, and so on
  * `affordable_kinds`: allowed part kinds, such as wide, compact, and in-memory
* **Return value**
  * A `DataParts` container with all parts that satisfy the conditions

```cpp
auto lock = lockParts();
```

* Acquire a lock so that `data_parts_indexes` cannot be modified while iterating.
* This matters because parts may be moved by background merge or mutation tasks at the same time.

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

* A nested loop goes through each `(state, kind)` pair and pulls the matching range from the internal index.
* `getDataPartsStateRange(state, kind)` returns an iterator range representing the matching parts.
* All those parts are collected into `res`.

### MergeTreeData::renameTempPartAndReplace

This function lives in [src/Storages/MergeTree/MergeTreeData.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeData.cpp#L4810)

This function is mainly the **final step of the MergeTree INSERT flow**.

```cpp
MergeTreeData::DataPartsVector MergeTreeData::renameTempPartAndReplace(
    MutableDataPartPtr & part,
    Transaction & out_transaction,
    bool rename_in_transaction)
```

* **Input parameters**
  * `part`: the freshly written **temporary part** (`tmp_xxx`)
  * `out_transaction`: transaction object used to ensure the replacement is atomic
  * `rename_in_transaction`: whether the rename should happen inside the transaction, optionally delayed until commit
* **Return value**
  * `covered_parts`: old parts covered or replaced by the new part, such as overlapping small parts

```cpp
auto part_lock = lockParts();
```

* Lock the `parts` container so the replacement process is thread-safe.
* This is necessary because background merge and mutation tasks may be working on parts at the same time.

```cpp
renameTempPartAndReplaceImpl(part, out_transaction, part_lock, &covered_parts, rename_in_transaction);
```

* The core logic lives in `renameTempPartAndReplaceImpl`:
  1. Rename the `tmp_xxx` part to its real name, such as `all_1_1_0`
  2. Update `data_parts_indexes` and insert the new part
  3. Find old parts overlapping with it and mark them as outdated or remove them directly
  4. If `rename_in_transaction` is enabled, these updates take effect together at transaction commit

```cpp
return covered_parts;
```

> The old parts that were covered are returned to the caller, which is useful for later handling such as detach or delete.

#### INSERT Flow

1. The user runs `INSERT INTO table VALUES (...)`
2. ClickHouse writes the data as a **temporary part** whose name starts with `tmp_`, so a crash in the middle of writing will not pollute the active parts
3. After the write finishes, `renameTempPartAndReplace(...)` is called:
   * Rename `tmp_xxx` to the final part name
   * Update the in-memory index structure
   * Remove older parts that it covers
4. Once INSERT commits successfully, the new part becomes visible to queries

This gives you the following benefits:
1. **Temporary file protection**:
   * Every INSERT is first written as a `tmp_` part. Only when the final rename succeeds does it become visible, ensuring atomicity.
2. **Optimistic merge**:
   * When a new part is inserted, overlapping older parts are covered too, which keeps the state clean.
3. **Transaction consistency**:
   * With `rename_in_transaction`, multiple operations can commit or roll back together, supporting more complex ALTER and REPLACE operations.

## Merge (Background Merge / Compaction)

**Representative functions**:
* `MergeTreeDataMergerMutator::mergePartsToTemporaryPart(...)`
* `MergeTreeBackgroundExecutor<Queue>::trySchedule(...)`
* `MergeTask::execute(...)`

The core of MergeTree is: **no updates, only new parts, with background merges later**.

* Inserts create many small parts.
* A background task (`tryScheduleMerge`) picks several small parts and calls `mergePartsToTemporaryPart` to merge them into one larger part.
* During the merge process, TTL and compression policies are applied, eventually freeing disk space and speeding up queries.

> **This is the secret behind ClickHouse keeping high write throughput: writes are fast, and cleanup happens slowly in the background.**

### MergeTreeBackgroundExecutor<Queue>::trySchedule

This function lives in [src/Storages/MergeTree/MergeTreeBackgroundExecutor.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeBackgroundExecutor.cpp#L140)

This function is the **entry point for MergeTree merge and background task scheduling**.

```cpp
template <class Queue>
bool MergeTreeBackgroundExecutor<Queue>::trySchedule(ExecutableTaskPtr task)
```

* **Purpose**: try to put a background task, such as merge, mutation, or TTL cleanup, into the execution queue
* **Return**:
  * `true` -> scheduled successfully
  * `false` -> rejected, possibly because the system is shutting down or the queue is full

#### Lock protection

```cpp
std::lock_guard lock(mutex);
```
Protect the `pending` task queue from concurrent modification.

#### Check whether the current task count exceeds the limit

```cpp
auto & value = CurrentMetrics::values[metric];
if (value.load() >= static_cast<int64_t>(max_tasks_count))
    return false;
```

* `CurrentMetrics` tracks the current number of tasks for this executor.
* If the count exceeds `max_tasks_count`, for example the configured limit on concurrent merges, the schedule request is rejected.

#### Put the task into the queue

```cpp
pending.push(std::make_shared<TaskRuntimeData>(std::move(task), metric));
```

* Wrap the incoming `task` in `TaskRuntimeData` and push it into the `pending` queue.
* `TaskRuntimeData` carries the metric used to track task execution state.

#### Wake up a worker thread

```cpp
has_tasks.notify_one();
```

* Wake one waiting worker thread so it can start processing the task.

#### Summary

This function provides **non-blocking scheduling**, **resource control**, and **monitoring**. It avoids merging too many parts at once, which would otherwise flood disk I/O, and keeps all task counts visible in `CurrentMetrics` so monitoring systems can observe current merge and mutation pressure.

### MergeTreeDataMergerMutator::mergePartsToTemporaryPart

This function lives in [src/Storages/MergeTree/MergeTreeDataMergerMutator.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeDataMergerMutator.cpp#L557)

This function is the **entry point of MergeTree merging**. Let's break it down step by step:

* **Purpose**: create a `MergeTask` that represents one merge or mutation job
* **Location**: `src/Storages/MergeTree/MergeTreeDataMergerMutator.cpp`
* **Return value**: `MergeTaskPtr`, a pointer to the newly created `MergeTask`

**Note**: this part only **constructs** the `MergeTask`. The actual merge logic runs inside `MergeTask::execute()`.

#### Parameters
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
  * The new part that will be produced, describing the source parts and the output name
  * It is the blueprint for the merge
* **`metadata_snapshot`**
  * A snapshot of table metadata, including columns, indexes, TTL, and more
* **`merge_entry / projection_merge_list_element`**
  * Track the merge record in `system.merges` or `system.part_log` for monitoring
* **`holder`**
  * Table lock, ensuring the merge does not conflict with DDL
* **`space_reservation`**
  * Reserved disk space so the merge does not fail because of insufficient capacity
* **`deduplicate / deduplicate_by_columns`**
  * Whether deduplication is needed, for example with `ReplacingMergeTree` or `OPTIMIZE TABLE ... DEDUPLICATE`
* **`cleanup`**
  * Whether cleanup such as TTL should run during the merge
* **`merging_params`**
  * MergeTree merge parameters, such as normal, Collapsing, VersionedCollapsing, Summing, or Aggregating
* **`txn`**
  * Transaction support for multi-statement transactions or MVCC
* **`need_prefix / parent_part / suffix`**
  * Control how the new part is named, especially for mutation and projection merge scenarios

#### Conditional logic

```cpp
if (future_part->isResultPatch())
{
    merging_params = MergeTreeData::getMergingParamsForPatchParts();
    metadata_snapshot = future_part->parts.front()->getMetadataSnapshot();
}
```

* If this is a **patch merge** such as a mutation patch, adjust `merging_params` and fetch metadata again from the source part.

#### Return value

```cpp
return std::make_shared<MergeTask>(...);
```

* Finally, a `MergeTask` is created with all the context needed for merging:
  * Which parts to merge (`future_part`)
  * How to merge (`merging_params`, `deduplicate`, `cleanup`)
  * Resources needed (`space_reservation`, `holder`)
  * Logging and tracing (`merge_entry`, `projection_merge_list_element`)

> **After that, the background thread pool calls `MergeTask::execute()`, which actually reads the source parts, merges them, and outputs the new part.**

So the role of `mergePartsToTemporaryPart(...)` is:

1. **It does not merge the data directly**. It **builds a MergeTask**.
2. The MergeTask carries all the context: parts, metadata, transaction state, disk space, deduplication, TTL, and logs.
3. The background executor schedules and runs the MergeTask, eventually producing a new **temporary part**.
4. After the temporary part succeeds, `renameTempPartAndReplace(...)` turns it into a formal part.

### MergeTask::execute(...)

This function lives in [src/Storages/MergeTree/MergeTask.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTask.cpp#L1590)

This is the **core function that actually executes MergeTree merges**.

* It represents the execution logic of one merge or mutation task.
* **Feature**: the merge is not done in one shot. Instead, it is split into **multiple stages** and executed step by step.
* Return value:
  * `true` -> there are more stages left and the task still needs to continue
  * `false` -> all stages are finished and the merge is complete

#### Fetch the current stage

```cpp
chassert(stages_iterator != stages.end());
const auto & current_stage = *stages_iterator;
```

* `MergeTask` owns a `stages` vector, following a pipeline-style design.
* `stages_iterator` points to the stage currently being executed.

#### Try to execute the current stage

```cpp
if (current_stage->execute())
    return true;
```

* If the current stage is not done yet, return `true`, meaning the next round still has to continue the same stage.
* Note that a stage may itself be expensive, such as reading, compressing, or writing, so it can be split across multiple runs.

#### Stage finished, record elapsed time

```cpp
UInt64 current_elapsed_ms = global_ctx->merge_list_element_ptr->watch.elapsedMilliseconds();
UInt64 stage_elapsed_ms = current_elapsed_ms - global_ctx->prev_elapsed_ms;
global_ctx->prev_elapsed_ms = current_elapsed_ms;
```

* Record the time difference since the previous checkpoint, which gives the time spent in this stage.
* `global_ctx` is the merge task's global context, including the ProfileEvents tracker.

#### Update `ProfileEvents`

```cpp
if (global_ctx->parent_part == nullptr)
{
    ProfileEvents::increment(current_stage->getTotalTimeProfileEvent(), stage_elapsed_ms);
    ProfileEvents::increment(ProfileEvents::MergeTotalMilliseconds, stage_elapsed_ms);
}
```

* If this is not a projection merge, update the total elapsed time statistics.
* Each stage has its own `ProfileEvent`, such as `MergeReadBlocks` or `MergeWriteBlocks`.

#### Move to the next stage

```cpp
+stages_iterator;
if (stages_iterator == stages.end())
    return false;
```

* Advance the iterator to the next stage.
* If we have reached `stages.end()`, the merge is fully complete and the function returns `false`.

#### Initialize the next stage

```cpp
(*stages_iterator)->setRuntimeContext(std::move(next_stage_context), global_ctx);
```
