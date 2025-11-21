# Crawling Service Data Contracts

> ⚠️ **Note (as of 2025-11-20)**
>
> The schemas in this file (`WatchBase`, `CreateWatch`, `Watch`, etc.) come from the
> changedetection.io watch service. The current NewsInsight collector only calls
> Crawl4AI's `/crawl` endpoint and does not persist these watch objects.
> Use this as reference material for a potential future integration.

## Watch Schemas

### WatchBase
Fields common to watch creation and update operations.
- `url` (string, uri, required): Target URL to monitor, max 5000 chars.
- `title` (string, optional): Friendly label up to 5000 chars.
- `tag` (string, optional): Single tag UUID.
- `tags` (array[string], optional): Multiple tag UUIDs.
- `paused` (boolean): Whether monitoring is paused.
- `muted` (boolean): Whether notifications are suppressed.
- `method` (string, enum: GET/POST/DELETE/PUT): HTTP verb used to fetch content.
- `fetch_backend` (string, enum: `html_requests`, `html_webdriver`): Fetch mechanism.
- `headers` (object[string]): Custom HTTP headers.
- `body` (string, optional): Request payload, max 5000 chars.
- `proxy` (string, optional): Proxy identifier/config.
- `webdriver_delay` (integer): Delay (seconds) when using webdriver backend.
- `webdriver_js_execute_code` (string): Custom JS snippet executed by webdriver, max 5000 chars.
- `time_between_check` (object): Interval configuration with fields `weeks`, `days`, `hours`, `minutes`, `seconds` (integers).
- `notification_urls` (array[string]): Overrides global notifications for this watch.
- `notification_title` (string): Custom notification title (max 5000 chars).
- `notification_body` (string): Custom notification body (max 5000 chars).
- `notification_format` (string, enum: `Text`, `HTML`, `Markdown`).
- `track_ldjson_price_data` (boolean): Enable product price tracking via JSON-LD.
- `browser_steps` (array[object]): Pre-fetch automation steps. Each step requires:
  - `operation` (string)
  - `selector` (string)
  - `optional_value` (string)

### CreateWatch
- Extends `WatchBase`.
- Requires `url`.

### Watch
- Extends `WatchBase`.
- Adds read-only fields:
  - `uuid` (string, uuid)
  - `last_checked` (integer): Unix timestamp.
  - `last_changed` (integer): Unix timestamp.
  - `last_error` (string): Last fetch error message.
  - `last_viewed` (integer): Unix timestamp of last viewing (0+).

## Tag Schema
- `uuid` (string, uuid, read-only)
- `title` (string, required)
- `notification_urls` (array[string], optional)
- `notification_muted` (boolean, optional)

## NotificationUrls Schema
- `notification_urls` (array[string uri], required): Complete replacement set.

## SystemInfo Schema
- `watch_count` (integer)
- `tag_count` (integer)
- `uptime` (string)
- `version` (string)

## SearchResult Schema
- `watches` (object): Map of watch UUIDs to Watch objects.

## WatchHistory Schema
- Object mapping timestamps to snapshot file paths (string).

## Error Schema
- `message` (string): Error explanation.
