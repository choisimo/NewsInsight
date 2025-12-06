package com.newsinsight.collector.service;

import com.newsinsight.collector.dto.SearchHistoryDto;
import com.newsinsight.collector.entity.search.SearchHistory;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Sinks;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * SSE event service for real-time search history updates.
 * Broadcasts new search history entries to connected clients.
 */
@Service
@Slf4j
public class SearchHistoryEventService {

    private final Sinks.Many<SearchHistoryEventDto> eventSink;
    private final AtomicLong subscriberCount = new AtomicLong(0);

    public SearchHistoryEventService() {
        this.eventSink = Sinks.many().multicast().onBackpressureBuffer(256);
    }

    /**
     * Subscribe to the search history event stream.
     * Returns a Flux that emits events when new search history entries are saved.
     * 
     * Events include:
     * - new_search: A new search was saved
     * - updated_search: An existing search was updated
     * - deleted_search: A search was deleted
     * - heartbeat: Keep-alive signal (every 30 seconds)
     */
    public Flux<SearchHistoryEventDto> getEventStream() {
        return Flux.merge(
            eventSink.asFlux(),
            createHeartbeat()
        )
        .doOnSubscribe(sub -> {
            long count = subscriberCount.incrementAndGet();
            log.debug("New subscriber connected to search history stream. Total: {}", count);
        })
        .doOnCancel(() -> {
            long count = subscriberCount.decrementAndGet();
            log.debug("Subscriber disconnected from search history stream. Total: {}", count);
        })
        .doOnError(err -> log.error("Error in search history stream: {}", err.getMessage()));
    }

    /**
     * Get current subscriber count
     */
    public long getSubscriberCount() {
        return subscriberCount.get();
    }

    /**
     * Notify subscribers of a new search history entry.
     */
    public void notifyNewSearch(SearchHistory searchHistory) {
        if (subscriberCount.get() == 0) {
            log.debug("No subscribers, skipping event broadcast");
            return;
        }

        SearchHistoryDto dto = SearchHistoryDto.fromEntity(searchHistory);
        SearchHistoryEventDto event = new SearchHistoryEventDto(
            "new_search",
            dto,
            System.currentTimeMillis()
        );
        
        log.debug("Broadcasting new search event: type={}, query='{}'", 
                searchHistory.getSearchType(), searchHistory.getQuery());
        
        Sinks.EmitResult result = eventSink.tryEmitNext(event);
        if (result.isFailure()) {
            log.warn("Failed to emit search history event: {}", result);
        }
    }

    /**
     * Notify subscribers of an updated search history entry.
     */
    public void notifyUpdatedSearch(SearchHistory searchHistory) {
        if (subscriberCount.get() == 0) {
            return;
        }

        SearchHistoryDto dto = SearchHistoryDto.fromEntity(searchHistory);
        SearchHistoryEventDto event = new SearchHistoryEventDto(
            "updated_search",
            dto,
            System.currentTimeMillis()
        );
        
        log.debug("Broadcasting updated search event: id={}", searchHistory.getId());
        eventSink.tryEmitNext(event);
    }

    /**
     * Notify subscribers of a deleted search history entry.
     */
    public void notifyDeletedSearch(Long id) {
        if (subscriberCount.get() == 0) {
            return;
        }

        SearchHistoryEventDto event = new SearchHistoryEventDto(
            "deleted_search",
            Map.of("id", id),
            System.currentTimeMillis()
        );
        
        log.debug("Broadcasting deleted search event: id={}", id);
        eventSink.tryEmitNext(event);
    }

    /**
     * Create heartbeat events to keep connection alive.
     */
    private Flux<SearchHistoryEventDto> createHeartbeat() {
        return Flux.interval(Duration.ofSeconds(30))
            .map(tick -> new SearchHistoryEventDto(
                "heartbeat",
                Map.of("tick", tick, "subscribers", subscriberCount.get()),
                System.currentTimeMillis()
            ));
    }

    /**
     * DTO for SSE events
     */
    public record SearchHistoryEventDto(
        String eventType,
        Object data,
        long timestamp
    ) {}
}
