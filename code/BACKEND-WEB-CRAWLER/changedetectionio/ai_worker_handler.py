"""
AI-Enhanced Worker Handler for ChangeDetection.io

Integrates with the hybrid collector service to provide:
- AI-powered content analysis during monitoring
- Intelligent change detection with sentiment analysis
- Pension-focused monitoring capabilities
- Enhanced notification with AI insights
"""

import asyncio
import os
import sys
import threading
import time
from typing import Dict, Any, Optional, List
from enum import Enum

# Fallback logger if loguru not available
try:
    from loguru import logger
except ImportError:
    import logging
    logger = logging.getLogger(__name__)

# Add parent directory to path for imports
backend_collector_path = os.path.join(os.path.dirname(__file__), '..', '..', 'BACKEND-WEB-COLLECTOR')
if backend_collector_path not in sys.path:
    sys.path.insert(0, backend_collector_path)

# Define fallback enums if imports fail
class CollectionStrategy(Enum):
    TRADITIONAL = "traditional"
    AI_ENHANCED = "ai_enhanced"
    SMART_SCRAPING = "smart_scraping"
    HYBRID = "hybrid"

class ScrapeStrategy(Enum):
    SMART_SCRAPER = "smart_scraper"
    SEARCH_SCRAPER = "search_scraper"
    STRUCTURED_SCRAPER = "structured_scraper"

# Try to import AI services
AI_AVAILABLE = False
HybridCollectorService = None
GeminiClient = None
ScrapeGraphAIAdapter = None

try:
    from hybrid_collector_service import (
        HybridCollectorService as _HybridCollectorService, 
        CollectionStrategy as _CollectionStrategy
    )
    from gemini_client import GeminiClient as _GeminiClient
    from scrapegraph_adapter import (
        ScrapeGraphAIAdapter as _ScrapeGraphAIAdapter, 
        ScrapeRequest, 
        ScrapeStrategy as _ScrapeStrategy
    )
    
    # Override with imported classes
    HybridCollectorService = _HybridCollectorService
    CollectionStrategy = _CollectionStrategy
    GeminiClient = _GeminiClient
    ScrapeGraphAIAdapter = _ScrapeGraphAIAdapter
    ScrapeStrategy = _ScrapeStrategy
    
    AI_AVAILABLE = True
    logger.info("AI services successfully imported")
except ImportError as e:
    logger.warning(f"AI services not available: {e}")
    # Keep fallback classes defined above

# Import original worker handler functionality
try:
    from . import worker_handler as original_worker
except ImportError:
    logger.warning("Original worker handler not available")
    
    # Create minimal fallback
    class OriginalWorker:
        currently_processing_uuids = set()
    
    original_worker = OriginalWorker()


class AIEnhancedWorkerHandler:
    """
    Enhanced worker handler that integrates AI capabilities
    with the existing ChangeDetection.io worker system
    """
    
    def __init__(self, datastore, update_queue, notification_queue):
        """Initialize AI-enhanced worker handler"""
        self.datastore = datastore
        self.update_queue = update_queue
        self.notification_queue = notification_queue
        
        # Initialize AI services if available
        self.ai_enabled = AI_AVAILABLE and os.getenv('ENABLE_AI', '1') in ('1', 'true', 'True')
        self.hybrid_service = None
        
        if self.ai_enabled:
            try:
                self.hybrid_service = HybridCollectorService()
                logger.success("AI-enhanced worker handler initialized with hybrid service")
            except Exception as e:
                logger.error(f"Failed to initialize hybrid service: {e}")
                self.ai_enabled = False
        else:
            logger.info("AI-enhanced worker handler initialized without AI services")
    
    async def process_watch_with_ai(self, watch_uuid: str, skip_when_locked: bool = True) -> Dict[str, Any]:
        """
        Process a watch with AI-enhanced analysis
        
        Args:
            watch_uuid: UUID of the watch to process
            skip_when_locked: Skip if watch is currently being processed
            
        Returns:
            Processing results with AI analysis
        """
        if watch_uuid in original_worker.currently_processing_uuids:
            if skip_when_locked:
                logger.debug(f"Watch {watch_uuid} is already being processed, skipping")
                return {"status": "skipped", "reason": "already_processing"}
            else:
                # Wait for the current processing to finish
                while watch_uuid in original_worker.currently_processing_uuids:
                    await asyncio.sleep(0.1)
        
        # Mark as processing
        original_worker.currently_processing_uuids.add(watch_uuid)
        
        try:
            watch = self.datastore.data['watching'].get(watch_uuid)
            if not watch:
                return {"status": "error", "error": "Watch not found"}
            
            watch_url = watch.get('url', '')
            logger.info(f"Processing watch {watch_uuid} for URL: {watch_url}")
            
            # Get processing strategy recommendation if AI is enabled
            strategy = CollectionStrategy.TRADITIONAL
            ai_analysis = None
            
            if self.ai_enabled and self.hybrid_service:
                try:
                    # Analyze URL to determine optimal strategy
                    url_analysis = await self.hybrid_service.analyze_url_content(watch_url)
                    strategy = CollectionStrategy(url_analysis.get("recommended_strategy", "traditional"))
                    ai_analysis = url_analysis
                    
                    logger.info(f"AI recommended strategy: {strategy.value} for {watch_url}")
                    logger.debug(f"AI analysis confidence: {url_analysis.get('confidence', 0.0)}")
                    
                except Exception as e:
                    logger.error(f"AI analysis failed for {watch_url}: {e}")
                    strategy = CollectionStrategy.TRADITIONAL
            
            # Process watch based on strategy
            result = await self._process_with_strategy(watch_uuid, watch, strategy, ai_analysis)
            
            # Enhance result with AI insights if available
            if self.ai_enabled and ai_analysis:
                result["ai_analysis"] = ai_analysis
                result["strategy_used"] = strategy.value
                result["ai_confidence"] = ai_analysis.get("confidence", 0.0)
                result["pension_relevance"] = ai_analysis.get("pension_relevance", 0.0)
            
            return result
            
        except Exception as e:
            logger.error(f"Error processing watch {watch_uuid}: {e}")
            return {"status": "error", "error": str(e)}
        
        finally:
            # Remove from processing set
            original_worker.currently_processing_uuids.discard(watch_uuid)
    
    async def _process_with_strategy(
        self, 
        watch_uuid: str, 
        watch: Dict[str, Any], 
        strategy: CollectionStrategy,
        ai_analysis: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Process watch using the determined strategy
        
        Args:
            watch_uuid: UUID of the watch
            watch: Watch configuration
            strategy: Collection strategy to use
            ai_analysis: Optional AI analysis results
            
        Returns:
            Processing results
        """
        watch_url = watch.get('url', '')
        
        if strategy == CollectionStrategy.SMART_SCRAPING and self.ai_enabled:
            return await self._process_smart_scraping(watch_uuid, watch, ai_analysis)
        elif strategy == CollectionStrategy.AI_ENHANCED and self.ai_enabled:
            return await self._process_ai_enhanced(watch_uuid, watch, ai_analysis)
        elif strategy == CollectionStrategy.HYBRID and self.ai_enabled:
            return await self._process_hybrid(watch_uuid, watch, ai_analysis)
        else:
            # Fall back to traditional processing
            return await self._process_traditional(watch_uuid, watch)
    
    async def _process_smart_scraping(
        self, 
        watch_uuid: str, 
        watch: Dict[str, Any], 
        ai_analysis: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Process using smart scraping with ScrapeGraphAI"""
        watch_url = watch.get('url', '')
        
        try:
            # Use ScrapeGraphAI for intelligent content extraction
            prompt = "Extract and analyze pension-related content, detect important changes"
            
            result = await self.hybrid_service.smart_scrape_content(
                url=watch_url,
                prompt=prompt,
                strategy=ScrapeStrategy.SMART_SCRAPER
            )
            
            if result["success"]:
                # Process the AI-extracted content
                content_data = result["data"]
                
                # Check for significant changes using AI analysis
                change_detected = await self._detect_ai_changes(
                    watch_uuid, content_data, ai_analysis
                )
                
                return {
                    "status": "success",
                    "strategy": "smart_scraping",
                    "change_detected": change_detected,
                    "content_analysis": content_data,
                    "execution_time": result["execution_time"],
                    "tokens_used": result["tokens_used"]
                }
            else:
                logger.error(f"Smart scraping failed for {watch_url}: {result['error']}")
                # Fall back to traditional processing
                return await self._process_traditional(watch_uuid, watch)
                
        except Exception as e:
            logger.error(f"Smart scraping error for {watch_url}: {e}")
            return await self._process_traditional(watch_uuid, watch)
    
    async def _process_ai_enhanced(
        self, 
        watch_uuid: str, 
        watch: Dict[str, Any], 
        ai_analysis: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Process using AI-enhanced traditional monitoring"""
        watch_url = watch.get('url', '')
        
        try:
            # First, perform traditional content fetching
            traditional_result = await self._process_traditional(watch_uuid, watch)
            
            if traditional_result["status"] == "success" and self.hybrid_service:
                # Enhance with AI analysis
                if traditional_result.get("change_detected"):
                    # Analyze the changed content for pension relevance and sentiment
                    content = traditional_result.get("content", "")
                    
                    ai_content_analysis = self.hybrid_service.gemini_client.analyze_pension_content(
                        content=content,
                        url=watch_url
                    )
                    
                    # Add AI insights to the result
                    traditional_result["ai_enhancement"] = ai_content_analysis
                    traditional_result["strategy"] = "ai_enhanced"
                    
                    # Generate enhanced notifications if high relevance
                    relevance = ai_content_analysis.get("relevance_score", 0.0)
                    if relevance > 0.8:
                        traditional_result["priority"] = "high"
                        traditional_result["alert_reason"] = "High pension relevance detected"
            
            return traditional_result
            
        except Exception as e:
            logger.error(f"AI enhancement error for {watch_url}: {e}")
            return await self._process_traditional(watch_uuid, watch)
    
    async def _process_hybrid(
        self, 
        watch_uuid: str, 
        watch: Dict[str, Any], 
        ai_analysis: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Process using hybrid approach - combines multiple strategies"""
        watch_url = watch.get('url', '')
        
        try:
            # Start with traditional processing for reliability
            traditional_result = await self._process_traditional(watch_uuid, watch)
            
            # If changes detected, enhance with AI analysis
            if traditional_result.get("change_detected") and self.hybrid_service:
                # Use smart scraping for detailed analysis of changes
                smart_result = await self._process_smart_scraping(watch_uuid, watch, ai_analysis)
                
                # Combine results
                hybrid_result = traditional_result.copy()
                hybrid_result["strategy"] = "hybrid"
                hybrid_result["traditional_analysis"] = traditional_result
                
                if smart_result["status"] == "success":
                    hybrid_result["smart_analysis"] = smart_result["content_analysis"]
                    hybrid_result["ai_tokens_used"] = smart_result.get("tokens_used", 0)
                
                return hybrid_result
            
            return traditional_result
            
        except Exception as e:
            logger.error(f"Hybrid processing error for {watch_url}: {e}")
            return await self._process_traditional(watch_uuid, watch)
    
    async def _process_traditional(
        self, 
        watch_uuid: str, 
        watch: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Process using traditional ChangeDetection.io method"""
        # This would integrate with the existing ChangeDetection.io processing logic
        # For now, return a placeholder that simulates traditional processing
        
        watch_url = watch.get('url', '')
        
        try:
            # Simulate traditional processing
            # In actual implementation, this would call the existing worker logic
            logger.info(f"Processing {watch_url} using traditional method")
            
            # Placeholder for actual implementation
            return {
                "status": "success",
                "strategy": "traditional",
                "change_detected": False,  # Would be determined by actual logic
                "content": "",  # Would contain actual content
                "processing_time": 1.0
            }
            
        except Exception as e:
            logger.error(f"Traditional processing error for {watch_url}: {e}")
            return {"status": "error", "error": str(e)}
    
    async def _detect_ai_changes(
        self, 
        watch_uuid: str, 
        new_content: Dict[str, Any], 
        ai_analysis: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Use AI to detect significant changes in content
        
        Args:
            watch_uuid: UUID of the watch
            new_content: New content analysis from AI
            ai_analysis: Previous AI analysis for comparison
            
        Returns:
            True if significant changes detected
        """
        try:
            # Get previous content analysis from datastore
            watch = self.datastore.data['watching'].get(watch_uuid, {})
            previous_analysis = watch.get('last_ai_analysis', {})
            
            if not previous_analysis:
                # First run, consider it a change
                return True
            
            # Compare key metrics
            current_sentiment = new_content.get('sentiment', 'neutral')
            previous_sentiment = previous_analysis.get('sentiment', 'neutral')
            
            current_relevance = new_content.get('relevance_score', 0.0)
            previous_relevance = previous_analysis.get('relevance_score', 0.0)
            
            current_topics = set(new_content.get('key_topics', []))
            previous_topics = set(previous_analysis.get('key_topics', []))
            
            # Detect significant changes
            sentiment_changed = current_sentiment != previous_sentiment
            relevance_changed = abs(current_relevance - previous_relevance) > 0.2
            topics_changed = len(current_topics.symmetric_difference(previous_topics)) > 0
            
            policy_impact_increased = (
                new_content.get('policy_impact') == 'high' and 
                previous_analysis.get('policy_impact') != 'high'
            )
            
            significant_change = (
                sentiment_changed or 
                relevance_changed or 
                topics_changed or 
                policy_impact_increased
            )
            
            if significant_change:
                # Update stored analysis
                watch['last_ai_analysis'] = new_content
                logger.info(f"AI detected significant changes for watch {watch_uuid}")
            
            return significant_change
            
        except Exception as e:
            logger.error(f"AI change detection error for watch {watch_uuid}: {e}")
            return False
    
    def create_enhanced_notification(
        self, 
        watch_uuid: str, 
        processing_result: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Create enhanced notification with AI insights
        
        Args:
            watch_uuid: UUID of the watch
            processing_result: Results from processing
            
        Returns:
            Enhanced notification data
        """
        watch = self.datastore.data['watching'].get(watch_uuid, {})
        watch_url = watch.get('url', '')
        
        notification = {
            "watch_uuid": watch_uuid,
            "url": watch_url,
            "timestamp": time.time(),
            "strategy_used": processing_result.get("strategy", "traditional"),
            "change_detected": processing_result.get("change_detected", False)
        }
        
        # Add AI insights if available
        if "ai_analysis" in processing_result:
            ai_data = processing_result["ai_analysis"]
            notification["ai_insights"] = {
                "sentiment": ai_data.get("sentiment", "neutral"),
                "confidence": ai_data.get("confidence", 0.0),
                "pension_relevance": ai_data.get("pension_relevance", 0.0),
                "key_topics": ai_data.get("key_topics", []),
                "policy_impact": ai_data.get("policy_impact", "low")
            }
            
            # Add priority based on AI analysis
            relevance = ai_data.get("pension_relevance", 0.0)
            if relevance > 0.8:
                notification["priority"] = "high"
            elif relevance > 0.5:
                notification["priority"] = "medium"
            else:
                notification["priority"] = "low"
        
        # Add content analysis if available
        if "content_analysis" in processing_result:
            notification["content_summary"] = processing_result["content_analysis"].get("summary", "")
        
        return notification


# Integration functions with original worker handler
def initialize_ai_enhanced_workers(datastore, update_queue, notification_queue):
    """Initialize AI-enhanced worker system"""
    global ai_worker_handler
    
    try:
        ai_worker_handler = AIEnhancedWorkerHandler(datastore, update_queue, notification_queue)
        logger.success("AI-enhanced worker handler initialized successfully")
        return ai_worker_handler
    except Exception as e:
        logger.error(f"Failed to initialize AI-enhanced worker handler: {e}")
        return None


# Global AI worker handler instance
ai_worker_handler = None