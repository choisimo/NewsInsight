# Crawling Service Overview

## Service Summary
- **Service Name**: BACKEND-WEB-CRAWLER (based on changedetection.io)
- **Primary Function**: Monitors web pages for content changes and triggers notifications when deltas are detected.
- **Base API URL**: `/api/v1/`
- **Supported Protocols**: HTTP, HTTPS (production should prefer HTTPS)
- **Default Port**: 5000 (container mapped as `127.0.0.1:5000:5000`)
- **Authentication**: Header `x-api-key` required for authenticated endpoints

## Core Capabilities
- **Watch Lifecycle Management**: Create, update, list, and delete watches representing monitored URLs.
- **Historical Tracking**: Retains timestamped snapshots and favicon assets per watch for change comparisons.
- **Tag & Grouping**: Organize watches into logical tags/groups with shared notification policies.
- **Notification Routing**: Configure global endpoints compatible with Apprise (email, Slack, Discord, webhook, etc.).
- **Search & Bulk Operations**: Filter watches via query parameters and import large URL sets in one request.
- **Operational Insights**: System info endpoint exposes watch/tag counts, uptime, and version metadata.

## Deployment Footprint
- Delivered via Docker service `changedetection` with persistent volume `changedetection-data`.
- Optional browser fetchers (Playwright/Selenium, sockpuppetbrowser) can be attached for JavaScript-heavy sites.
- Extensive environment variable support: proxies, concurrency (`FETCH_WORKERS`), scheduling limits, locale/timezone, TLS certs, logging levels, screenshot bounds, etc.
- Designed to run behind reverse proxies; base URL and forwarded header settings configurable.
