---
title: "ClickHouse Series: The Six Core Mechanisms of MergeTree from the Source Code"
published: 2025-09-03
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, Ironman]
category: 'software development'
draft: false
lang: 'en'
---

Across the first 29 days of this series, we have already understood ClickHouse table engine design from the user's perspective:
* Why use columnar storage?
* If MergeTree does not use a B-tree, how does it rely on min-max indexes for fast queries?
* How do background merges, materialized views, and TTL actually work?

Today, as the closing article of the series, we are going to step into the ClickHouse GitHub source code from a **developer's perspective** and explore the internal structure of MergeTree.

I picked out the 6 most important modules and functions from a huge codebase (thank you GPT 🤚😭🤚), corresponding to the lifecycle of MergeTree: from **creation → insertion → merge → query → movement**.

::github{repo="clickhouse/clickhouse"}

I recommend reading this with two windows open side by side. I will specifically call out where each function lives.

## Initialization and Format Management

`MergeTreeData::initializeDirectoriesAndFormatVersion(...)`

This function is in [src/Storages/MergeTree/MergeTreeData.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeData.cpp#L381)

* This function is responsible for initializing the table's data directories.
* Responsibilities:
  * Check/create data directories
  * Read or write `format_version.txt` (written to the first non-readonly disk)
  * Check whether **custom partitioning** is supported
* Design goal:
  * Ensure on-disk data is compatible with the program version
  * If the version is too old, throw an exception directly and block startup

Below is the part of the code that writes `format_version.txt`. It explains why a write-once disk is effectively read-only for MergeTree (for example, S3 object storage). We cannot write to it because it does not support move or delete operations, and otherwise a later `DROP` could leave garbage behind and waste space.
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

> **Without this step, none of the later parts can be read or written correctly.**

## Parts Management (Immutable data parts)

**Representative functions**:

* `MergeTreeData::loadDataParts(...)`
* `MergeTreeData::getDataParts(...)`
* `MergeTreeData::renameTempPartAndReplace(...)`

In MergeTree, **data is not one complete giant table, but a collection of immutable parts**.

* **At startup**: `loadDataParts` scans disks and loads all parts into in-memory index structures
* **When inserting data**: every INSERT first creates a temporary part, then `renameTempPartAndReplace` publishes it into the parts directory
* **When querying**: `getDataParts` returns a consistent view of parts (supporting a snapshot-style concept)

> This is why MergeTree can support both **efficient reads** and **high-concurrency writes** at the same time.

### MergeTreeData::loadDataParts

This function is in [src/Storages/MergeTree/MergeTreeData.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeData.cpp#L2121)

`loadDataParts` is responsible for:

1. **Scanning disks** → find all data directories that match MergeTree part naming rules
2. **Checking disk validity** → ensure parts do not appear on undefined disks
3. **Building a PartLoadingTree** → organize all parts into a tree (supporting containment relationships, for example when a new part covers an old part)
4. **Loading parts into memory** → create `DataPart` objects and insert them into `data_parts_indexes`
5. **Handling abnormal cases** → broken parts, duplicate parts, unexpected parts, outdated parts
6. **Statistics and monitoring** → record load duration and counts via `ProfileEvents`

#### Check orphaned parts

```cpp
if (!getStoragePolicy()->isDefaultPolicy() && !skip_sanity_checks ...)
{
    // Ensure all parts are located on disks defined in the storage policy
    // If a part is found on an unknown disk, throw an Exception directly
}
```

> This prevents the situation where the physical data still exists but the metadata can no longer point to it, preserving consistency.

#### Scan disks and collect parts

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

* Skip special directories such as `tmp*`, `format_version.txt`, and `detached/`
* Check whether the directory name can be parsed into `MergeTreePartInfo` (if not, treat it as garbage and ignore it)
* Split parts into **expected** (normal) and **unexpected** (found unexpectedly)

#### Build the PartLoadingTree

```cpp
auto loading_tree = PartLoadingTree::build(std::move(parts_to_load));
```

* Parts may have containment relationships between them (for example, a new part covering the range of an old part)
* `PartLoadingTree` helps identify the top-level, most complete parts to treat as active parts

#### Load active parts

```cpp
auto loaded_parts = loadDataPartsFromDisk(active_parts);
```

For each active part:
* Check whether it is broken (missing files, compression errors, and so on)
* Check whether it is a duplicate
* Determine index granularity (adaptive vs. non-adaptive)
* Record whether it contains lightweight delete or transaction metadata

> This is the key step that turns on-disk directories into `DataPart` objects.

#### Handle abnormal cases

* **broken parts**: move to `detached/broken-on-start/`
* **duplicate parts**: delete them (unless on static storage)
* **unexpected parts**: record them and let a background task handle them
* **outdated parts**: also pass them to a background task for asynchronous loading

#### Defensive check

```cpp
if (have_non_adaptive_parts && have_adaptive_parts && !enable_mixed_granularity_parts)
    throw Exception(...);
```

> If the table contains both **old non-adaptive granularity parts** and **new adaptive parts**, mixed use is disallowed by default unless `enable_mixed_granularity_parts` is enabled.

#### Monitoring logs and task registration

```cpp
LOG_DEBUG(log, "Loaded data parts ({} items) took {} seconds", data_parts_indexes.size(), watch.elapsedSeconds());
ProfileEvents::increment(ProfileEvents::LoadedDataParts, data_parts_indexes.size());
```

* Use logs and `ProfileEvents` to record how long part loading took and how many parts were loaded
* If all disks are readonly (for example, all of them are cold storage), a periodic task is started to refresh parts

### MergeTreeData::getDataParts

This function is in [src/Storages/MergeTree/MergeTreeData.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeData.cpp#L7640)

This function is short, but it is **where query reads decide which parts to read**.

```cpp
MergeTreeData::DataParts MergeTreeData::getDataParts(
    const DataPartStates & affordable_states,
    const DataPartsKinds & affordable_kinds) const
```

* **Input parameters**
  * `affordable_states`: allowed part states (active, outdated, temporary, ...)
  * `affordable_kinds`: allowed part kinds (wide, compact, in-memory, ...)
* **Return value**
  * A `DataParts` container containing the currently matching parts

```cpp
auto lock = lockParts();
```

* Acquire a lock so `data_parts_indexes` cannot be modified during iteration
* Parts may be moved concurrently by background merge or mutation tasks

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

* A nested loop iterates through every `(state, kind)` combination and takes the matching range from internal indexes
* `getDataPartsStateRange(state, kind)` returns the iterator range representing current matching parts
* All such parts are collected into `res`

### MergeTreeData::renameTempPartAndReplace

This function is in [src/Storages/MergeTree/MergeTreeData.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeData.cpp#L4810)

This function is basically **the final step of the INSERT flow into MergeTree**.

```cpp
MergeTreeData::DataPartsVector MergeTreeData::renameTempPartAndReplace(
    MutableDataPartPtr & part,
    Transaction & out_transaction,
    bool rename_in_transaction)
```

* **Input parameters**
  * `part`: the freshly written **temporary part (`tmp_xxx`)**
  * `out_transaction`: transaction object used to make part replacement atomic
  * `rename_in_transaction`: whether rename should happen inside the transaction (or be delayed until commit)
* **Return value**
  * `covered_parts`: old parts covered and replaced by the new part (for example, overlapped smaller parts)

```cpp
auto part_lock = lockParts();
```

* Lock the `parts` container to keep replacement thread-safe
* Background merge and mutation tasks may be operating on parts at the same time

```cpp
renameTempPartAndReplaceImpl(part, out_transaction, part_lock, &covered_parts, rename_in_transaction);
```

* The core logic is inside `renameTempPartAndReplaceImpl`:
  1. Actually **rename** `tmp_xxx` into a formal part name (for example, `all_1_1_0`)
  2. Update `data_parts_indexes` and insert the new part
  3. Find old parts that overlap with it and mark them outdated or remove them directly
  4. If `rename_in_transaction` is enabled, these updates become visible together at transaction commit

```cpp
return covered_parts;
```

> It returns the old covered parts to the caller for later processing such as detach or delete.

#### INSERT flow

1. The user runs `INSERT INTO table VALUES (...)`
2. ClickHouse writes the data into a **temporary part** (name starts with `tmp_`) so a crash in the middle cannot pollute active parts
3. After writing finishes, `renameTempPartAndReplace(...)` is called:
   * Rename `tmp_xxx` into a formal part name
   * Update the in-memory index structure
   * Remove old parts covered by it
4. Once the INSERT commit succeeds, the new part becomes visible to queries

This enables the following:
1. **Temp file protection**
   * Every INSERT first writes a `tmp_` part and only becomes effective after the final rename succeeds, ensuring atomicity
2. **Optimistic merge**
   * When inserting a new part, overlapped old parts can be covered at the same time so data does not accumulate in an inconsistent state
3. **Transaction consistency**
   * With `rename_in_transaction`, multiple operations can commit or roll back together, supporting more complex ALTER and REPLACE flows


## Merge (Background Merge / Compaction)

**Representative functions**:
* `MergeTreeDataMergerMutator::mergePartsToTemporaryPart(...)`
* `MergeTreeBackgroundExecutor<Queue>::trySchedule(...)`
* `MergeTask::execute(...)`

The core idea of MergeTree is: **no in-place updates, only new parts, then background merges later**.

* Inserts produce many small parts
* Background tasks (`tryScheduleMerge`) choose several small parts and call `mergePartsToTemporaryPart` to merge them into one larger part
* During the merge, TTL and compression policies are also applied, which eventually frees disk space and speeds up reads

> **This is the secret behind ClickHouse's high write throughput: writes stay fast, and cleanup happens gradually in the background.**

### MergeTreeBackgroundExecutor<Queue>::trySchedule

This function is in [src/Storages/MergeTree/MergeTreeBackgroundExecutor.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeBackgroundExecutor.cpp#L140)

This function is the **entry point for scheduling MergeTree merges and background tasks**.

```cpp
template <class Queue>
bool MergeTreeBackgroundExecutor<Queue>::trySchedule(ExecutableTaskPtr task)
```

* **Purpose**: try to place a background task (for example merge, mutation, or TTL cleanup) into the execution queue
* **Return value**:
  * `true` → scheduled successfully
  * `false` → rejected (for example because the system is shutting down or the queue is full)

#### Lock protection

```cpp
std::lock_guard lock(mutex);
```
Protects the `pending` task queue so multiple threads do not modify it at the same time.

#### Check whether the current task count exceeds the limit

```cpp
auto & value = CurrentMetrics::values[metric];
if (value.load() >= static_cast<int64_t>(max_tasks_count))
    return false;
```

* Use `CurrentMetrics` to monitor how many tasks this executor is currently running
* If it exceeds `max_tasks_count` (for example the maximum number of concurrent merges), scheduling is rejected

#### Push the task into the queue

```cpp
pending.push(std::make_shared<TaskRuntimeData>(std::move(task), metric));
```

* Wrap the incoming `task` as `TaskRuntimeData` and push it into the `pending` queue
* `TaskRuntimeData` carries the metric used to track the task's execution state

#### Notify a worker thread

```cpp
has_tasks.notify_one();
```

* Wake one waiting worker thread so it can start handling the task

#### Summary

This function provides **non-blocking scheduling**, **resource control**, and **monitoring**. It prevents too many parts from being merged at once and blowing up disk I/O. All task counts are reflected in `CurrentMetrics`, making current merge and mutation pressure visible to the monitoring system.


### MergeTreeDataMergerMutator::mergePartsToTemporaryPart

This function is in [src/Storages/MergeTree/MergeTreeDataMergerMutator.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeDataMergerMutator.cpp#L557)

This function is the **entry point for MergeTree merges**. Let's break it down step by step:

* **Purpose**: create a `MergeTask`, which represents one merge or mutation task
* **Location**: `src/Storages/MergeTree/MergeTreeDataMergerMutator.cpp`
* **Return value**: `MergeTaskPtr` (a pointer to the newly created `MergeTask`)

**Important**: this stage only **constructs** the `MergeTask`. The actual merge logic runs inside `MergeTask::execute()`.

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
  * The new part that will be produced, describing source parts and output name
  * It is the blueprint of the merge plan
* **`metadata_snapshot`**
  * A snapshot of table metadata, including columns, indexes, TTL, and so on
* **`merge_entry / projection_merge_list_element`**
  * Used to track this merge in `system.merges` (or `system.part_log`) for monitoring
* **`holder`**
  * A table lock to ensure the merge does not conflict with DDL
* **`space_reservation`**
  * Reserved disk space so the merge does not fail partway through because of insufficient space
* **`deduplicate / deduplicate_by_columns`**
  * Whether deduplication is needed (relevant for `ReplacingMergeTree` and `OPTIMIZE TABLE ... DEDUPLICATE`)
* **`cleanup`**
  * Whether cleanup such as TTL should run during the merge
* **`merging_params`**
  * MergeTree merge parameters (normal, Collapsing, VersionedCollapsing, Summing, Aggregating, and more)
* **`txn`**
  * Transaction context that supports multi-statement transactions or MVCC
* **`need_prefix / parent_part / suffix`**
  * Control how the new part is named, especially for mutations and projection merges

#### Conditional logic

```cpp
if (future_part->isResultPatch())
{
    merging_params = MergeTreeData::getMergingParamsForPatchParts();
    metadata_snapshot = future_part->parts.front()->getMetadataSnapshot();
}
```

* If this is a **patch merge** (for example, a mutation patch), adjust `merging_params` and reload metadata from the source part

#### Return value

```cpp
return std::make_shared<MergeTask>(...);
```

* Finally create a `MergeTask` containing all merge context:
  * which parts to merge (`future_part`)
  * how to merge them (`merging_params`, `deduplicate`, `cleanup`)
  * resources needed during the merge (`space_reservation`, `holder`)
  * log tracing (`merge_entry`, `projection_merge_list_element`)

> **Later, the background thread pool will call `MergeTask::execute()` and actually read the source parts, merge them, and produce a new temporary part.**

So the role of `mergePartsToTemporaryPart(...)` is:

1. **It does not merge data directly**, but instead **creates a MergeTask**
2. The MergeTask carries all context: parts, metadata, transaction, disk space, deduplication, TTL, and logs
3. The Background Executor schedules and runs this MergeTask, producing a new **temporary part**
4. After the temporary part succeeds, `renameTempPartAndReplace(...)` turns it into a formal part


### MergeTask::execute(...)

This function is in [src/Storages/MergeTree/MergeTask.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTask.cpp#L1590)

This function is the **core function where MergeTree actually performs a merge**.

* It represents the execution logic of one **merge or mutation** task
* **Characteristic**: the merge is not done all at once, but is split into **multiple stages**
* Return value:
  * `true` → there are still later stages to run
  * `false` → all stages are complete, and the merge is finished

#### Get the current stage

```cpp
chassert(stages_iterator != stages.end());
const auto & current_stage = *stages_iterator;
```

* `MergeTask` owns a `stages` vector, conceptually a pipeline
* `stages_iterator` points to the stage currently being executed

#### Try to execute the current stage

```cpp
if (current_stage->execute())
    return true;
```

* If the current stage is not finished yet, return `true` so it continues next time
* Note: a stage itself can be expensive (such as reading, compressing, or writing), so it may run in batches

#### Stage finished → record elapsed time

```cpp
UInt64 current_elapsed_ms = global_ctx->merge_list_element_ptr->watch.elapsedMilliseconds();
UInt64 stage_elapsed_ms = current_elapsed_ms - global_ctx->prev_elapsed_ms;
global_ctx->prev_elapsed_ms = current_elapsed_ms;
```

* Record the time delta since the previous checkpoint as the time spent in this stage
* `global_ctx` is the global context of the merge task and contains ProfileEvents trackers

#### Update ProfileEvents

```cpp
if (global_ctx->parent_part == nullptr)
{
    ProfileEvents::increment(current_stage->getTotalTimeProfileEvent(), stage_elapsed_ms);
    ProfileEvents::increment(ProfileEvents::MergeTotalMilliseconds, stage_elapsed_ms);
}
```

* If this is not a projection merge, update total time statistics
* Every stage has a matching ProfileEvent such as `MergeReadBlocks` or `MergeWriteBlocks`

#### Move to the next stage

```cpp
++stages_iterator;
if (stages_iterator == stages.end())
    return false;
```

* Advance the iterator to the next stage
* If `stages.end()` is reached, the merge is fully complete, so return `false`

#### Initialize the next stage

```cpp
(*stages_iterator)->setRuntimeContext(std::move(next_stage_context), global_ctx);
return true;
```

* Pass the output context of the previous stage into the next stage, like a pipeline
* Return `true` to indicate there is still more work to run

#### Exception handling

```cpp
catch (...)
{
    merge_failures.withLabels({String(ErrorCodes::getName(getCurrentExceptionCode()))}).increment();
    throw;
}
```

* If the merge fails (I/O error, disk full, corrupted data, and so on), record the failure count and rethrow the exception
* `merge_failures` is a metrics counter that tracks failure categories


## Query Read Path

**Representative functions**:

* [`MergeTreeDataSelectExecutor::read(...)`](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeDataSelectExecutor.cpp#L173)
* [`MergeTreeDataSelectExecutor::readFromParts(...)`](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeDataSelectExecutor.cpp#L1283)

When a user runs `SELECT`, the query flow enters `MergeTreeDataSelectExecutor::read`:

1. Choose parts that match the partition scope
2. Use indexes to prune granules (for example min-max indexes)
3. Call `readFromParts` to read the actual data blocks needed
4. Send the data into the QueryPlan pipeline (Filter, Join, Aggregate, Sort, and more)

```cpp
const auto & snapshot_data = assert_cast<const MergeTreeData::SnapshotData &>(*storage_snapshot->data);
```

* Every query gets a `StorageSnapshot`, which contains the currently visible parts and mutation snapshot of the table
* `snapshot_data.parts` → the parts this query will read
* `snapshot_data.mutations_snapshot` → ensures the query executes against one consistent version

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

* **Input parameters**:
  * `parts` → the data fragments to read
  * `mutations_snapshot` → guarantees consistency
  * `column_names_to_return` → read only required columns
  * `query_info` → contains conditions such as WHERE, ORDER BY, and LIMIT
  * `max_block_size` → max rows per block, controlling batch size
  * `num_streams` → number of threads reading in parallel
  * `enable_parallel_reading` → whether parallel reading from replicas is allowed

* **Return value**:
  * `step` → a `QueryPlanStep` (`ReadFromMergeTree`) that represents how to read data from MergeTree parts

```cpp
auto plan = std::make_unique<QueryPlan>();
if (step)
    plan->addStep(std::move(step));
return plan;
```

* Create an empty `QueryPlan`
* If a read step is produced successfully, add it to the plan
* Return the complete QueryPlan to the pipeline for execution

## Indexes and Filtering (Index & Skipping)

**Representative functions**:

* `MergeTreeWhereOptimizer::optimize(...)`

During query execution, ClickHouse does not do a full table scan. Instead, it relies on:

* **Primary key indexes** (sorted min-max ranges)
* **Data Skipping Indexes** (Bloom filters, Set indexes, Token indexes)

`MergeTreeWhereOptimizer::optimize` rewrites WHERE conditions to make the best possible use of indexes, pruning unnecessary granules so only required data is scanned.

This function is in [src/Storages/MergeTree/MergeTreeWhereOptimizer.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeWhereOptimizer.cpp#L104C1-L142C2)

This function analyzes `SELECT ... WHERE ...` conditions, decides which parts can be pushed down into **PREWHERE**, and rewrites the AST by moving some conditions there.

Characteristics of PREWHERE:
* **Read part of the columns first, filter out most rows, then read the remaining columns**
* It is especially effective for columnar storage query efficiency

```cpp
if (!select.where() || select.prewhere())
    return;
```

* If there is no WHERE clause, or PREWHERE already exists, there is nothing to optimize

```cpp
auto block_with_constants = KeyCondition::getBlockWithConstants(...);
```

* Collect constants used in the query to support condition pushdown

```cpp
WhereOptimizerContext where_optimizer_context;
where_optimizer_context.context = context;
where_optimizer_context.array_joined_names = determineArrayJoinedNames(select);
where_optimizer_context.move_all_conditions_to_prewhere = context->getSettingsRef()[Setting::move_all_conditions_to_prewhere];
...
```

* Prepare the context needed by the optimizer, including:

  * Whether all conditions should be forcibly moved to PREWHERE
  * Whether condition reordering is allowed
  * Whether statistics should be used
  * Whether the query includes `FINAL` (which may affect pushdown eligibility)

```cpp
RPNBuilderTreeContext tree_context(context, std::move(block_with_constants), {});
RPNBuilderTreeNode node(select.where().get(), tree_context);
auto optimize_result = optimizeImpl(node, where_optimizer_context);
```

* Parse the WHERE clause into a **boolean expression tree (RPN – Reverse Polish Notation)**
* Call `optimizeImpl` to try to push down suitable conditions
* The result includes:

  * `where_conditions` (conditions that remain in WHERE)
  * `prewhere_conditions` (conditions moved into PREWHERE)

```cpp
auto where_filter_ast = reconstructAST(optimize_result->where_conditions);
auto prewhere_filter_ast = reconstructAST(optimize_result->prewhere_conditions);

select.setExpression(ASTSelectQuery::Expression::WHERE, std::move(where_filter_ast));
select.setExpression(ASTSelectQuery::Expression::PREWHERE, std::move(prewhere_filter_ast));
```

* Reassemble the result back into the AST
* The SELECT query now becomes:

  ```sql
  SELECT ...
  PREWHERE <part of the conditions>
  WHERE <remaining conditions>
  ```

```cpp
LOG_DEBUG(
    log,
    "MergeTreeWhereOptimizer: condition \"{}\" moved to PREWHERE",
    select.prewhere()->formatForLogging(...));
```

* Write a log entry for the moved PREWHERE condition

> **This is one of the keys to second-level queries over tens of billions of rows.**

## TTL and Data Movement

**Representative functions**:

* `MergeTreeData::moveParts(...)`
* `MergeTreeData::removeOutdatedPartsAndDirs(...)`

MergeTree supports TTL (Time-to-Live), allowing data to expire automatically or move across storage tiers:

* **Delete old data** → `removeOutdatedPartsAndDirs` cleans up expired parts
* **Hot/cold tiering** → `moveParts` moves old data to slower disks (HDD, S3) while keeping fresh data on SSD

> **This makes MergeTree more than just an OLAP table. It also provides data lifecycle management.**

### `MergeTreeData::moveParts(...)`

This function is in [src/Storages/MergeTree/MergeTreeWhereOptimizer.cpp](https://github.com/ClickHouse/ClickHouse/blob/master/src/Storages/MergeTree/MergeTreeWhereOptimizer.cpp#L104C1-L142C2)

It physically moves parts between disks based on the StoragePolicy (for example SSD → HDD, or more cost-efficient tiers).

```cpp
LOG_INFO(log, "Got {} parts to move.", moving_tagger->parts_to_move.size());
MovePartsOutcome result{MovePartsOutcome::PartsMoved};
```

Record how many parts are going to be moved this time, and initially assume the result will be successful.

```cpp
for (const auto & moving_part : moving_tagger->parts_to_move)
```

Each part must be cloned and replaced.

```cpp
auto moves_list_entry = getContext()->getMovesList().insert(...);
```

Update the system table `system.moves` so users can observe which parts are currently being moved.

```cpp
if (supportsReplication() && disk->supportZeroCopyReplication() && (*settings)[MergeTreeSetting::allow_remote_fs_zero_copy_replication])
```

If the table is ReplicatedMergeTree and zero-copy replication is enabled:
  * Multiple replicas **cannot move the same part at the same time**, otherwise duplicate copies may be created
  * A **ZooKeeper / Keeper zero-copy lock** is used for mutual exclusion

```cpp
auto lock = tryCreateZeroCopyExclusiveLock(moving_part.part->name, disk);
if (!lock)
{
    result = MovePartsOutcome::MoveWasPostponedBecauseOfZeroCopy;
    break;
}
```

If the lock cannot be acquired, the move is postponed to avoid contention.

```cpp
cloned_part = parts_mover.clonePart(moving_part, read_settings, write_settings);
if (lock->isLocked())
    parts_mover.swapClonedPart(cloned_part);
```

* If the lock is still valid → clone the part, then replace it
* If the lock becomes invalid during cloning → postpone and retry later

```cpp
cloned_part = parts_mover.clonePart(moving_part, read_settings, write_settings);
parts_mover.swapClonedPart(cloned_part);
```

Directly clone → swap, completing the part move.


```cpp
write_part_log({});
```

Write into `system.part_log`, recording this `MOVE_PART` operation, including duration and source/destination disk.


```cpp
catch (...)
{
    write_part_log(ExecutionStatus::fromCurrentException("", true));
    throw;
}
```

If the move fails, record the error and rethrow the exception.

## Closing

This series finally comes to an end, graduating together with my summer internship XD (not really, I will still keep working on it after the semester starts). I hope you all enjoyed the series.

![](../../../assets/posts/clickhouse-mergetree-sourcecode-introduction.png)

Someone asked me before: "Vic, why did you want to start the Ironman challenge?" At the time, I wanted to use the pressure of a daily writing challenge to force myself to quickly dive deep into a service. I also noticed that there were very few ClickHouse articles in the market, and even when they existed, most of them focused only on usage. I may have been one of the first people to start writing about lower-level principles and architecture. Maybe the main audience is usually data scientists, so there are fewer backend engineers like me focusing on this?

ClickHouse is a fascinating data-processing beast at the TB-to-PB scale, but only if you have strong enough fundamentals to think through every scenario when designing tables. With the right table design strategy based on business logic and data types, it becomes extremely powerful.

During this internship, I migrated data for the company from the cloud. One single table in PostgreSQL was originally around **400GB**, but by using ClickHouse with the right configuration strategy, I achieved roughly **5x to 86x compression** depending on column data types. That saved the company **about 360GB** of storage cost on a single table while also improving query efficiency, which helped internal data analysis and automation work.

This entire series also indirectly verifies one thing: **why ClickHouse can handle both high-ingest workloads and large-scale queries at the same time, and why it has become a mainstream OLAP database service in the industry**.


### ClickHouse Series Complete:

1. [ClickHouse Series: What Is ClickHouse? How It Differs from Traditional OLAP/OLTP Databases](https://blog.vicwen.app/posts/what-is-clickhouse/)
2. [ClickHouse Series: Why Does ClickHouse Choose Column-based Storage? The Core Differences Between Row-based and Column-based Storage](https://blog.vicwen.app/posts/clickhouse-column-row-based-storage/)
3. [ClickHouse Series: ClickHouse Storage Engine - MergeTree](https://blog.vicwen.app/posts/clickhouse-mergetree-engine)
4. [ClickHouse Series: How Compression and Data Skipping Indexes Greatly Speed Up Queries](https://blog.vicwen.app/posts/clickhouse-compression-skipping-index/)
5. [ClickHouse Series: ReplacingMergeTree and Data Deduplication](https://blog.vicwen.app/posts/clickhouse-replacingmergetree-deduplication/)
6. [ClickHouse Series: SummingMergeTree for Data Aggregation Use Cases](https://blog.vicwen.app/posts/clickhouse-summingmergetree-aggregation/)
7. [ClickHouse Series: Materialized Views for Real-Time Aggregation Queries](https://blog.vicwen.app/posts/clickhouse-materialized-view/)
8. [ClickHouse Series: Partitioning Strategy and Partition Pruning Explained](https://blog.vicwen.app/posts/clickhouse-partition-pruning/)
9. [ClickHouse Series: How Primary Key, Sorting Key, and Granule Indexes Work](https://blog.vicwen.app/posts/clickhouse-primary-sorting-key/)
10. [ClickHouse Series: CollapsingMergeTree and Best Practices for Logical Deletion](https://blog.vicwen.app/posts/clickhouse-collapsingmergetree/)
11. [ClickHouse Series: VersionedCollapsingMergeTree for Version Control and Conflict Resolution](https://blog.vicwen.app/posts/clickhouse-versioned-collapsingmergetree/)
12. [ClickHouse Series: Advanced Uses of AggregatingMergeTree for Real-Time Metrics](https://blog.vicwen.app/posts/clickhouse-aggregatingmergetree/)
13. [ClickHouse Series: Distributed Tables and Distributed Query Architecture](https://blog.vicwen.app/posts/clickhouse-distributed-table-architecture/)
14. [ClickHouse Series: High Availability and Zero-Downtime Upgrades with Replicated Tables](https://blog.vicwen.app/posts/clickhouse-replication-failover/)
15. [ClickHouse Series: Building a Real-Time Data Streaming Pipeline with Kafka Integration](https://blog.vicwen.app/posts/clickhouse-kafka-data-streaming-pipeline/)
16. [ClickHouse Series: Best Practices for Batch Imports (CSV, Parquet, Native Format)](https://blog.vicwen.app/posts/clickhouse-batch-import/)
17. [ClickHouse Series: Integrating ClickHouse with External Data Sources (PostgreSQL)](https://blog.vicwen.app/posts/clickhouse-external-data-integration/)
18. [ClickHouse Series: How to Improve Query Performance with system.query_log and EXPLAIN](https://blog.vicwen.app/posts/clickhouse-query-log-explain/)
19. [ClickHouse Series: Advanced Query Acceleration with Projections](https://blog.vicwen.app/posts/clickhouse-projections-optimization/)
20. [ClickHouse Series: Sampling Queries and Statistical Techniques](https://blog.vicwen.app/posts/clickhouse-sampling-statistics/)
21. [ClickHouse Series: TTL Data Cleanup and Storage Cost Optimization](https://blog.vicwen.app/posts/clickhouse-ttl-storage-management/)
22. [ClickHouse Series: Storage Policies and Tiered Disk Strategy](https://blog.vicwen.app/posts/clickhouse-storage-policies/)
23. [ClickHouse Series: Table Design and Storage Optimization Details](https://blog.vicwen.app/posts/clickhouse-schemas-storage-improvement/)
24. [ClickHouse Series: Building Visual Monitoring with Grafana Integration](https://blog.vicwen.app/posts/clickhouse-grafana-dashboard/)
25. [ClickHouse Series: Query Optimization Case Studies](https://blog.vicwen.app/posts/clickhouse-select-optimization/)
26. [ClickHouse Series: Integrating with BI Tools (Power BI)](https://blog.vicwen.app/posts/clickhouse-bi-integration/)
27. [ClickHouse Series: ClickHouse Cloud vs. Self-Hosted Deployments](https://blog.vicwen.app/posts/clickhouse-cloud-vs-self-host/)
28. [ClickHouse Series: Implementing Database Security and RBAC](https://blog.vicwen.app/posts/clickhouse-security-rbac/)
29. [ClickHouse Series: Deploying a Distributed Architecture on Kubernetes](https://blog.vicwen.app/posts/clickhouse-operator-kubernates/)
30. [ClickHouse Series: The Six Core Mechanisms of MergeTree from the Source Code](https://blog.vicwen.app/posts/clickhouse-mergetree-sourcecode-introduction/)
