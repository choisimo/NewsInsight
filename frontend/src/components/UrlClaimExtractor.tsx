import { useState, useCallback } from "react";
import {
  Link as LinkIcon,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  Sparkles,
  FileText,
  Globe,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface ExtractedClaim {
  id: string;
  text: string;
  confidence: number;
  context?: string;
  selected: boolean;
}

interface UrlClaimExtractorProps {
  /** URL 추출 후 선택된 주장들을 전달하는 콜백 */
  onClaimsExtracted: (claims: string[]) => void;
  /** 현재 분석 중인지 여부 */
  disabled?: boolean;
  /** 추가 CSS 클래스 */
  className?: string;
}

/** URL 유효성 검사 */
const isValidUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

/** 신뢰도에 따른 색상 */
const getConfidenceColor = (confidence: number): string => {
  if (confidence >= 0.8) return "text-green-600";
  if (confidence >= 0.5) return "text-yellow-600";
  return "text-orange-600";
};

export function UrlClaimExtractor({
  onClaimsExtracted,
  disabled = false,
  className,
}: UrlClaimExtractorProps) {
  const [url, setUrl] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedClaims, setExtractedClaims] = useState<ExtractedClaim[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pageTitle, setPageTitle] = useState<string | null>(null);

  // URL에서 주장 추출 (Mock - 실제로는 API 호출)
  const extractClaims = useCallback(async () => {
    if (!url.trim() || !isValidUrl(url)) {
      setError("올바른 URL을 입력해주세요.");
      return;
    }

    setIsExtracting(true);
    setError(null);
    setExtractedClaims([]);
    setPageTitle(null);

    try {
      // API 호출 - 실제 구현 시 백엔드 API로 대체
      const response = await fetch(`/api/v1/analysis/extract-claims`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!response.ok) {
        // Mock fallback for development
        if (response.status === 404) {
          // Demo mode - generate sample claims
          await simulateExtraction();
          return;
        }
        throw new Error(`추출 실패: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.claims && Array.isArray(data.claims)) {
        setExtractedClaims(
          data.claims.map((claim: { text: string; confidence?: number; context?: string }, i: number) => ({
            id: `claim-${i}`,
            text: claim.text,
            confidence: claim.confidence || 0.7,
            context: claim.context,
            selected: true, // 기본적으로 모두 선택
          }))
        );
        setPageTitle(data.pageTitle || null);
      } else {
        throw new Error("주장을 추출할 수 없습니다.");
      }
    } catch (err) {
      console.error("Claim extraction failed:", err);
      // Fallback to simulation for demo
      await simulateExtraction();
    } finally {
      setIsExtracting(false);
    }
  }, [url]);

  // 시뮬레이션 (데모/개발용)
  const simulateExtraction = async () => {
    // 실제 URL에서 도메인 추출
    let domain = "example.com";
    try {
      domain = new URL(url).hostname;
    } catch {
      // ignore
    }

    // 시뮬레이션 딜레이
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // URL 기반 샘플 주장 생성
    const sampleClaims: ExtractedClaim[] = [
      {
        id: "claim-1",
        text: `해당 기사에서 주장하는 핵심 내용이 여기에 표시됩니다.`,
        confidence: 0.92,
        context: "기사 본문 첫 번째 단락에서 추출",
        selected: true,
      },
      {
        id: "claim-2",
        text: `통계적 수치나 구체적인 데이터를 포함한 주장이 추출됩니다.`,
        confidence: 0.85,
        context: "기사 내 데이터 섹션에서 추출",
        selected: true,
      },
      {
        id: "claim-3",
        text: `전문가 인용이나 연구 결과에 기반한 주장입니다.`,
        confidence: 0.78,
        context: "인용문에서 추출",
        selected: true,
      },
    ];

    setExtractedClaims(sampleClaims);
    setPageTitle(`${domain}에서 추출된 기사`);
  };

  // 주장 선택 토글
  const toggleClaim = useCallback((id: string) => {
    setExtractedClaims((prev) =>
      prev.map((claim) =>
        claim.id === id ? { ...claim, selected: !claim.selected } : claim
      )
    );
  }, []);

  // 모두 선택/해제
  const toggleAll = useCallback((selected: boolean) => {
    setExtractedClaims((prev) =>
      prev.map((claim) => ({ ...claim, selected }))
    );
  }, []);

  // 선택된 주장 적용
  const applyClaims = useCallback(() => {
    const selectedClaims = extractedClaims
      .filter((c) => c.selected)
      .map((c) => c.text);
    
    if (selectedClaims.length === 0) {
      setError("최소 1개 이상의 주장을 선택해주세요.");
      return;
    }

    onClaimsExtracted(selectedClaims);
    
    // 초기화
    setUrl("");
    setExtractedClaims([]);
    setPageTitle(null);
  }, [extractedClaims, onClaimsExtracted]);

  // 취소/초기화
  const handleReset = useCallback(() => {
    setUrl("");
    setExtractedClaims([]);
    setError(null);
    setPageTitle(null);
  }, []);

  const selectedCount = extractedClaims.filter((c) => c.selected).length;
  const hasResults = extractedClaims.length > 0;

  return (
    <Card className={cn("border-dashed border-2 border-muted-foreground/25", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-blue-600" />
          <CardTitle className="text-lg">URL에서 주장 추출</CardTitle>
          <Badge variant="secondary" className="text-xs">AI 자동 추출</Badge>
        </div>
        <CardDescription>
          뉴스 기사나 웹페이지 URL을 입력하면 AI가 자동으로 검증할 수 있는 주장들을 추출합니다.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* URL 입력 */}
        {!hasResults && (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError(null);
                }}
                placeholder="https://news.example.com/article/..."
                disabled={disabled || isExtracting}
                className="pl-10"
              />
            </div>
            <Button
              onClick={extractClaims}
              disabled={disabled || isExtracting || !url.trim()}
            >
              {isExtracting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  추출 중...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  추출
                </>
              )}
            </Button>
          </div>
        )}

        {/* 에러 메시지 */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* 추출 중 상태 */}
        {isExtracting && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <div className="text-center space-y-3">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
              <div>
                <p className="font-medium">URL 분석 중...</p>
                <p className="text-sm">페이지에서 검증 가능한 주장을 찾고 있습니다.</p>
              </div>
            </div>
          </div>
        )}

        {/* 추출 결과 */}
        {hasResults && !isExtracting && (
          <div className="space-y-4">
            {/* 페이지 정보 */}
            {pageTitle && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium truncate">{pageTitle}</span>
                <Badge variant="outline" className="ml-auto shrink-0">
                  {extractedClaims.length}개 주장 발견
                </Badge>
              </div>
            )}

            {/* 선택 컨트롤 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleAll(true)}
                  disabled={selectedCount === extractedClaims.length}
                >
                  모두 선택
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleAll(false)}
                  disabled={selectedCount === 0}
                >
                  모두 해제
                </Button>
              </div>
              <span className="text-sm text-muted-foreground">
                {selectedCount}개 선택됨
              </span>
            </div>

            {/* 주장 목록 */}
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
              {extractedClaims.map((claim) => (
                <div
                  key={claim.id}
                  className={cn(
                    "p-3 rounded-lg border transition-colors cursor-pointer",
                    claim.selected
                      ? "border-primary bg-primary/5"
                      : "border-muted hover:border-muted-foreground/50"
                  )}
                  onClick={() => toggleClaim(claim.id)}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={claim.selected}
                      onCheckedChange={() => toggleClaim(claim.id)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{claim.text}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={cn("text-xs", getConfidenceColor(claim.confidence))}>
                          신뢰도: {Math.round(claim.confidence * 100)}%
                        </span>
                        {claim.context && (
                          <span className="text-xs text-muted-foreground">
                            • {claim.context}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* 액션 버튼 */}
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={handleReset}
                className="flex-1"
              >
                <X className="h-4 w-4 mr-2" />
                취소
              </Button>
              <Button
                onClick={applyClaims}
                disabled={selectedCount === 0}
                className="flex-1"
              >
                <ArrowRight className="h-4 w-4 mr-2" />
                {selectedCount}개 주장 적용
              </Button>
            </div>
          </div>
        )}

        {/* 빈 상태 안내 */}
        {!hasResults && !isExtracting && !error && (
          <p className="text-xs text-muted-foreground text-center py-2">
            URL을 입력하고 "추출" 버튼을 클릭하세요. AI가 자동으로 사실 확인이 필요한 주장들을 찾아냅니다.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default UrlClaimExtractor;
