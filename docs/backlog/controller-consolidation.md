# Controller Consolidation - Future Refactoring

## Overview

The data-collection-service has four controllers with overlapping SSE/Job management functionality.
This document outlines the overlap and provides guidance for future consolidation.

## Current Controllers

| Controller | Path | Purpose |
|------------|------|---------|
| `SearchJobController` | `/api/v1/jobs` | Generic job management with SSE |
| `UnifiedSearchController` | `/api/v1/search` | Parallel search with SSE streaming |
| `DeepAnalysisController` | `/api/v1/analysis/deep` | Deep AI search with SSE |
| `LiveAnalysisController` | `/api/v1/analysis` | Live streaming analysis |

## Overlapping Functionality

### 1. Job Creation & Status
- `SearchJobController`: `createJob()`, `getJobStatus()`, `listJobs()`
- `UnifiedSearchController`: `startJobBasedSearch()`, job status via SSE
- `DeepAnalysisController`: `startDeepSearch()`, `getJobStatus()`, `listJobs()`

### 2. SSE Streaming
- All four controllers implement SSE streaming with heartbeats
- Each has its own EventService (`UnifiedSearchEventService`, `DeepSearchEventService`, `AnalysisEventService`)
- Pattern: 15-second heartbeat, event types (status, progress, result, complete, error)

### 3. AI Provider Fallback Chain
- `LiveAnalysisController`: Full fallback chain (Perplexity → OpenAI → OpenRouter → Azure → AIDove → Ollama → Custom)
- `UnifiedSearchController`: Similar AI fallback for analysis phase

### 4. Health Checks
- Each controller has its own health check endpoint
- All return similar service availability information

## Shared Event Services

Two event services with nearly identical structure:
- `UnifiedSearchEventService` (413 lines)
- `DeepSearchEventService` (311 lines)

Both implement:
- `ConcurrentHashMap` for job sinks
- `getOrCreateSink()` pattern
- `getJobEventStream()` with heartbeats
- Various `publish*()` methods
- `scheduleCleanup()` and `removeSink()`

## Recommended Consolidation (Future Work)

### Phase 1: Extract Shared Base
1. Create `BaseJobEventService` with common SSE patterns
2. Have `UnifiedSearchEventService` and `DeepSearchEventService` extend it
3. Estimated effort: 4-8 hours

### Phase 2: Unify Job Management
1. Create shared `JobService` interface
2. Implement job persistence in database (currently in-memory)
3. Estimated effort: 8-16 hours

### Phase 3: Consolidate Controllers (Optional)
1. Merge `SearchJobController` and `UnifiedSearchController` 
2. Keep `DeepAnalysisController` and `LiveAnalysisController` separate (different purposes)
3. Estimated effort: 16-24 hours

## Why Not Consolidated Now

1. **API Contract Risk**: Merging controllers would change API paths, breaking existing clients
2. **Different Purposes**: Each controller serves a distinct use case
3. **Testing Coverage**: Need comprehensive E2E tests before major refactoring
4. **Low Priority**: Current architecture works, duplication is maintainable

## Related Files

- `@/backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/SearchJobController.java`
- `@/backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/UnifiedSearchController.java`
- `@/backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/DeepAnalysisController.java`
- `@/backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/LiveAnalysisController.java`
- `@/backend/data-collection-service/src/main/java/com/newsinsight/collector/service/UnifiedSearchEventService.java`
- `@/backend/data-collection-service/src/main/java/com/newsinsight/collector/service/DeepSearchEventService.java`
