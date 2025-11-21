# Crawling Service API Endpoints

> ⚠️ **Note (as of 2025-11-20)**
>
> This document describes the HTTP API of a changedetection.io-based crawler service
> (watch/tag/notification endpoints). The current `data-collection-service` implementation
> integrates with Crawl4AI via a simple `/crawl` HTTP call (`Crawl4aiClient`), and does **not**
> call these endpoints directly. Treat this file as reference for an alternative/legacy design.

All endpoints are served under the base path `/api/v1/` and require the header `x-api-key` containing a valid API key unless stated otherwise.

## Watch Management

| Method | Path | Description |
| --- | --- | --- |
| GET | `/watch` | Retrieve the concise list of all registered watches. Optional `recheck_all=1` forces rechecks, `tag=<name>` filters by tag. |
| POST | `/watch` | Create a new watch. Requires at minimum the URL of the target page. |
| GET | `/watch/{uuid}` | Retrieve full details for a specific watch. Optional query parameters allow recheck (`recheck=1`), pause/unpause (`paused=<value>`), and mute/unmute (`muted=<value>`). |
| PUT | `/watch/{uuid}` | Update an existing watch with the full Watch schema payload. |
| DELETE | `/watch/{uuid}` | Delete a watch permanently. |

### Watch Payloads
- **Request Body (POST/PUT)**: JSON matching the `CreateWatch`/`Watch` schema, e.g.
  ```json
  {
    "url": "https://example.com",
    "title": "Example Monitor",
    "time_between_check": {"hours": 1}
  }
  ```
- **Success Responses**:
  - `GET /watch` → 200 with map of Watch objects.
  - `POST /watch` → 200 plain text `"OK"`.
  - `GET /watch/{uuid}` → 200 with Watch JSON or state change text.
  - `PUT /watch/{uuid}` → 200 `"OK"`.
  - `DELETE /watch/{uuid}` → 200 `"DELETED"`.

## Watch History & Assets

| Method | Path | Description |
| --- | --- | --- |
| GET | `/watch/{uuid}/history` | List all recorded timestamps for the watch along with snapshot file paths. |
| GET | `/watch/{uuid}/history/{timestamp}` | Fetch the stored snapshot payload (text/HTML) for a specific timestamp. |
| GET | `/watch/{uuid}/favicon` | Download the favicon associated with the watch as binary data. |

## Tag / Group Management

| Method | Path | Description |
| --- | --- | --- |
| GET | `/tags` | Retrieve all tags/groups with their notification settings. |
| POST | `/tag` | Create a new tag by specifying at least a `title`. |
| GET | `/tag/{uuid}` | Fetch tag details. Query options allow muting (`muted=<value>`) and bulk recheck of all watches in the tag (`recheck=1`). |

## Notifications

| Method | Path | Description |
| --- | --- | --- |
| GET | `/notifications` | List the global notification endpoints configured for the service. |
| POST | `/notifications` | Set or replace the global notification URLs by passing `notification_urls` array. |

## Search

| Method | Path | Description |
| --- | --- | --- |
| POST | `/search` | Filter watches using query parameters (URL pattern, tag list, mute/pause state). Returns matching watches keyed by UUID. |

## Bulk Import

| Method | Path | Description |
| --- | --- | --- |
| POST | `/import` | Import multiple watch URLs in a single request. Accepts plain text body (line-separated URLs). Optional query parameters: `tag_uuids`, `tag`, `proxy`, `dedupe` (default `true`). Returns array of created watch UUIDs. |

## System Information

| Method | Path | Description |
| --- | --- | --- |
| GET | `/systeminfo` | Returns high-level telemetry: watch & tag counts, uptime string, application version. |
