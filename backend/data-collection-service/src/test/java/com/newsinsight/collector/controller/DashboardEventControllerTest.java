package com.newsinsight.collector.controller;

import com.newsinsight.collector.service.DashboardEventService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.reactive.WebFluxTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.reactive.server.WebTestClient;

/**
 * DashboardEventController 단위 테스트
 */
@WebFluxTest(DashboardEventController.class)
@ActiveProfiles("test")
class DashboardEventControllerTest {

    @Autowired
    private WebTestClient webTestClient;

    @MockBean
    private DashboardEventService dashboardEventService;

    @Test
    @DisplayName("GET /api/v1/events/stream - SSE 스트림 연결")
    void testEventStream() {
        // SSE 스트림은 테스트가 복잡하므로 연결 자체만 테스트
        // 실제 테스트에서는 StepVerifier 사용 필요
        webTestClient.get()
            .uri("/api/v1/events/stream")
            .exchange()
            .expectStatus().isOk()
            .expectHeader().valueEquals("Content-Type", "text/event-stream");
    }
}
