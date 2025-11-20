package com.newsinsight.collector.mongo;

import org.springframework.data.mongodb.repository.MongoRepository;

public interface AiResponseRepository extends MongoRepository<AiResponseDocument, String> {
}
