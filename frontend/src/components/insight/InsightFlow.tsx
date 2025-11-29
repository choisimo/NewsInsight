import * as React from "react";
import { useState, useCallback, useEffect } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  IntroCard,
  ViewpointVSCard,
  DataVisualizationCard,
  ConclusionCard,
  EvidenceDetailCard,
} from "./InsightCards";
import {
  ProgressStepper,
  DEFAULT_INSIGHT_STEPS,
  NavigationControls,
} from "./ProgressStepper";
import type { DeepSearchResult, Evidence } from "@/lib/api";

// ============================================
// Types
// ============================================

interface InsightFlowProps {
  result: DeepSearchResult;
  onShare?: () => void;
  onDownload?: () => void;
  className?: string;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Generate summary points from evidence
 */
const generateSummaryPoints = (evidence: Evidence[]): string[] => {
  const points: string[] = [];

  // Get unique snippets, prioritizing diverse stances
  const stances = ["pro", "neutral", "con"] as const;
  for (const stance of stances) {
    const stanceEvidence = evidence.filter((e) => e.stance === stance);
    if (stanceEvidence.length > 0) {
      // Use title if available, otherwise use snippet
      const text = stanceEvidence[0].title || stanceEvidence[0].snippet;
      if (text && !points.includes(text)) {
        points.push(text.length > 100 ? text.substring(0, 100) + "..." : text);
      }
    }
    if (points.length >= 3) break;
  }

  // Fill remaining with any evidence
  for (const e of evidence) {
    if (points.length >= 3) break;
    const text = e.title || e.snippet;
    if (text && !points.includes(text)) {
      points.push(text.length > 100 ? text.substring(0, 100) + "..." : text);
    }
  }

  return points;
};

/**
 * Generate conclusion from distribution
 */
const generateConclusion = (result: DeepSearchResult): string => {
  const { proRatio, conRatio, neutralRatio } = result.stanceDistribution;

  if (Math.abs(proRatio - conRatio) < 10) {
    return `${result.topic}에 대해 의견이 팽팽하게 나뉘고 있습니다.`;
  } else if (proRatio > conRatio) {
    return `${result.topic}에 대해 전반적으로 긍정적인 평가가 우세합니다.`;
  } else {
    return `${result.topic}에 대해 우려와 비판적 시각이 다수를 차지합니다.`;
  }
};

/**
 * Generate key insight
 */
const generateKeyInsight = (result: DeepSearchResult): string => {
  const total = result.evidence.length;
  const { pro, con, neutral } = result.stanceDistribution;

  return `총 ${total}개의 출처를 분석한 결과, 찬성 ${pro}건, 반대 ${con}건, 중립 ${neutral}건의 의견이 수집되었습니다. 다양한 관점을 고려하여 균형 잡힌 판단을 내리시기 바랍니다.`;
};

// ============================================
// InsightFlow Component
// ============================================

export const InsightFlow = ({
  result,
  onShare,
  onDownload,
  className,
}: InsightFlowProps) => {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: false,
    dragFree: false,
    containScroll: "trimSnaps",
  });

  const [currentIndex, setCurrentIndex] = useState(0);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  // Separate evidence by stance
  const proEvidence = result.evidence.filter((e) => e.stance === "pro");
  const conEvidence = result.evidence.filter((e) => e.stance === "con");
  const neutralEvidence = result.evidence.filter((e) => e.stance === "neutral");

  // Generate content
  const summaryPoints = generateSummaryPoints(result.evidence);
  const conclusion = generateConclusion(result);
  const keyInsight = generateKeyInsight(result);

  // Steps configuration
  const steps = DEFAULT_INSIGHT_STEPS;

  // Update scroll state
  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setCurrentIndex(emblaApi.selectedScrollSnap());
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", onSelect);
    };
  }, [emblaApi, onSelect]);

  // Navigation handlers
  const scrollPrev = useCallback(() => {
    emblaApi?.scrollPrev();
  }, [emblaApi]);

  const scrollNext = useCallback(() => {
    emblaApi?.scrollNext();
  }, [emblaApi]);

  const scrollTo = useCallback(
    (index: number) => {
      emblaApi?.scrollTo(index);
    },
    [emblaApi]
  );

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        scrollPrev();
      } else if (e.key === "ArrowRight") {
        scrollNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [scrollPrev, scrollNext]);

  return (
    <div className={cn("w-full", className)}>
      {/* Progress Stepper */}
      <div className="mb-6">
        <ProgressStepper
          steps={steps}
          currentStep={currentIndex}
          onStepClick={scrollTo}
          variant="steps"
          className="px-4"
        />
      </div>

      {/* Carousel Container */}
      <div className="relative">
        {/* Navigation Arrows (Desktop) */}
        <Button
          variant="outline"
          size="icon"
          onClick={scrollPrev}
          disabled={!canScrollPrev}
          className={cn(
            "absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 z-10",
            "hidden md:flex",
            "h-12 w-12 rounded-full shadow-lg",
            "bg-background/80 backdrop-blur-sm",
            !canScrollPrev && "opacity-0 pointer-events-none"
          )}
        >
          <ChevronLeft className="h-6 w-6" />
        </Button>

        <Button
          variant="outline"
          size="icon"
          onClick={scrollNext}
          disabled={!canScrollNext}
          className={cn(
            "absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-10",
            "hidden md:flex",
            "h-12 w-12 rounded-full shadow-lg",
            "bg-background/80 backdrop-blur-sm",
            !canScrollNext && "opacity-0 pointer-events-none"
          )}
        >
          <ChevronRight className="h-6 w-6" />
        </Button>

        {/* Embla Carousel */}
        <div ref={emblaRef} className="overflow-hidden">
          <div className="flex touch-pan-y">
            {/* Slide 1: Intro Card */}
            <div className="flex-none w-full min-w-0 px-4">
              <div className="h-[500px] md:h-[550px]">
                <IntroCard
                  topic={result.topic}
                  summaryPoints={summaryPoints}
                  evidenceCount={result.evidence.length}
                />
              </div>
            </div>

            {/* Slide 2: Viewpoint VS Card */}
            <div className="flex-none w-full min-w-0 px-4">
              <div className="h-[500px] md:h-[550px]">
                <ViewpointVSCard
                  topic={result.topic}
                  proPoints={proEvidence}
                  conPoints={conEvidence}
                  distribution={result.stanceDistribution}
                />
              </div>
            </div>

            {/* Slide 3: Data Visualization Card */}
            <div className="flex-none w-full min-w-0 px-4">
              <div className="h-[500px] md:h-[550px]">
                <DataVisualizationCard
                  distribution={result.stanceDistribution}
                  topic={result.topic}
                  evidenceCount={result.evidence.length}
                />
              </div>
            </div>

            {/* Slide 4: Evidence Detail Card */}
            <div className="flex-none w-full min-w-0 px-4">
              <div className="h-[500px] md:h-[550px]">
                <EvidenceDetailCard evidence={result.evidence} stance="all" />
              </div>
            </div>

            {/* Slide 5: Conclusion Card */}
            <div className="flex-none w-full min-w-0 px-4">
              <div className="h-[500px] md:h-[550px]">
                <ConclusionCard
                  topic={result.topic}
                  conclusion={conclusion}
                  keyInsight={keyInsight}
                  distribution={result.stanceDistribution}
                  onShare={onShare}
                  onDownload={onDownload}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Navigation Controls */}
      <div className="mt-6 md:hidden px-4">
        <NavigationControls
          currentStep={currentIndex}
          totalSteps={steps.length}
          onPrevious={scrollPrev}
          onNext={scrollNext}
          canGoPrevious={canScrollPrev}
          canGoNext={canScrollNext}
        />
      </div>

      {/* Dots indicator (alternative compact view) */}
      <div className="mt-6 hidden md:block">
        <ProgressStepper
          steps={steps}
          currentStep={currentIndex}
          onStepClick={scrollTo}
          variant="dots"
        />
      </div>

      {/* Keyboard hint */}
      <div className="mt-4 text-center text-xs text-muted-foreground hidden md:block">
        ← → 키보드 방향키로 탐색하세요
      </div>
    </div>
  );
};

// ============================================
// Compact InsightFlow (for smaller views)
// ============================================

interface CompactInsightFlowProps {
  result: DeepSearchResult;
  className?: string;
}

export const CompactInsightFlow = ({
  result,
  className,
}: CompactInsightFlowProps) => {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: false,
    align: "start",
    containScroll: "trimSnaps",
    dragFree: true,
  });

  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!emblaApi) return;

    const onSelect = () => {
      setCurrentIndex(emblaApi.selectedScrollSnap());
    };

    emblaApi.on("select", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi]);

  const proEvidence = result.evidence.filter((e) => e.stance === "pro");
  const conEvidence = result.evidence.filter((e) => e.stance === "con");

  const cards = [
    { id: "summary", title: "요약", color: "bg-primary/10" },
    { id: "pro", title: `찬성 (${proEvidence.length})`, color: "bg-teal-100 dark:bg-teal-900/30" },
    { id: "con", title: `반대 (${conEvidence.length})`, color: "bg-coral-100 dark:bg-coral-900/30" },
    { id: "conclusion", title: "결론", color: "bg-primary/10" },
  ];

  return (
    <div className={cn("w-full", className)}>
      {/* Progress dots */}
      <div className="flex justify-center gap-1.5 mb-4">
        {cards.map((_, idx) => (
          <div
            key={idx}
            className={cn(
              "w-2 h-2 rounded-full transition-all",
              idx === currentIndex ? "w-6 bg-primary" : "bg-muted-foreground/30"
            )}
          />
        ))}
      </div>

      {/* Horizontal scroll cards */}
      <div ref={emblaRef} className="overflow-hidden -mx-4 px-4">
        <div className="flex gap-4">
          {cards.map((card) => (
            <div
              key={card.id}
              className={cn(
                "flex-none w-72 h-48 rounded-xl p-4",
                "border border-border/50",
                card.color
              )}
            >
              <h4 className="font-semibold mb-2">{card.title}</h4>
              <p className="text-sm text-muted-foreground line-clamp-5">
                {card.id === "summary" &&
                  `"${result.topic}"에 대한 ${result.evidence.length}개 출처 분석`}
                {card.id === "pro" && proEvidence[0]?.snippet}
                {card.id === "con" && conEvidence[0]?.snippet}
                {card.id === "conclusion" && generateConclusion(result)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default InsightFlow;
