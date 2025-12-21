package com.newsinsight.collector.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.aop.interceptor.AsyncUncaughtExceptionHandler;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.AsyncConfigurer;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

@Configuration
@EnableAsync
@EnableScheduling
@Slf4j
public class AsyncConfig implements AsyncConfigurer {

    @Value("${async.executor.core-pool-size:5}")
    private int corePoolSize;

    @Value("${async.executor.max-pool-size:20}")
    private int maxPoolSize;

    @Value("${async.executor.queue-capacity:100}")
    private int queueCapacity;

    @Value("${async.chat-sync.core-pool-size:3}")
    private int chatSyncCorePoolSize;

    @Value("${async.chat-sync.max-pool-size:10}")
    private int chatSyncMaxPoolSize;

    @Value("${async.chat-sync.queue-capacity:50}")
    private int chatSyncQueueCapacity;

    /**
     * 기본 비동기 작업 실행자
     */
    @Bean(name = "taskExecutor")
    public Executor taskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(corePoolSize);
        executor.setMaxPoolSize(maxPoolSize);
        executor.setQueueCapacity(queueCapacity);
        executor.setThreadNamePrefix("async-collection-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(60);
        executor.setRejectedExecutionHandler((r, e) -> 
                log.warn("Task rejected from taskExecutor: {}", r.toString()));
        executor.initialize();
        return executor;
    }

    /**
     * 채팅 동기화 전용 실행자
     */
    @Bean(name = "chatSyncExecutor")
    public Executor chatSyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(chatSyncCorePoolSize);
        executor.setMaxPoolSize(chatSyncMaxPoolSize);
        executor.setQueueCapacity(chatSyncQueueCapacity);
        executor.setThreadNamePrefix("chat-sync-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(120); // 동기화 완료 대기 2분
        executor.setRejectedExecutionHandler((r, e) -> 
                log.warn("Task rejected from chatSyncExecutor: {}", r.toString()));
        executor.initialize();
        return executor;
    }

    /**
     * 벡터 임베딩 전용 실행자
     */
    @Bean(name = "embeddingExecutor")
    public Executor embeddingExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(5);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("embedding-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(180); // 임베딩 완료 대기 3분
        executor.setRejectedExecutionHandler((r, e) -> 
                log.warn("Task rejected from embeddingExecutor: {}", r.toString()));
        executor.initialize();
        return executor;
    }

    @Override
    public Executor getAsyncExecutor() {
        return taskExecutor();
    }

    @Override
    public AsyncUncaughtExceptionHandler getAsyncUncaughtExceptionHandler() {
        return (ex, method, params) -> {
            log.error("Uncaught async exception in method {}: {}", method.getName(), ex.getMessage(), ex);
        };
    }
}
