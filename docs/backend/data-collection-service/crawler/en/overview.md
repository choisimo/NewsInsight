# Crawling Service Overview

## Service Summary
- Service Name: Crawl4AI (web-crawler)
- Primary Function: Fetches rendered HTML/text for JS-heavy pages via headless browser
- Base API URL: defaults to `http://web-crawler:11235`
- Health: `GET /health`, Playground: `/playground`

## Integration in Collector
- Toggle: `collector.crawler.enabled` (default false)
- Base URL: `collector.crawler.base-url` (default `http://web-crawler:11235`)
- Env via Consul seed (`config/collector-service/`):
  - `COLLECTOR_SERVICE_CRAWLER_ENABLED=true|false`
  - `COLLECTOR_SERVICE_CRAWLER_BASE_URL=http://web-crawler:11235`

### Behavior
- If enabled, collector tries Crawl4AI first; on failure/short content it falls back to `Jsoup` parsing of raw HTML.
- Metadata field `scrape_method` records `crawl4ai` or `jsoup` per item.

## Local Run
1. `docker compose -f etc/docker/docker-compose.consul.yml up -d`
2. Visit `http://localhost:11235/playground` to verify crawler UI.
3. Collector uses internal DNS `http://web-crawler:11235`.

## Notes
- Adjust timeouts with `collector.http.timeout.*` if pages are slow.
- For strict sites, consider honoring robots.txt and rate limits upstream.
