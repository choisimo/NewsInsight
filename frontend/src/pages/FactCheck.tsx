/**
 * FactCheck - 팩트체크 전용 페이지
 * 
 * ML 기반 뉴스 기사 팩트체크 및 신뢰도 분석 페이지
 * - 주장 추출 및 검증
 * - 출처 신뢰도 분석
 * - 클릭베이트/허위정보 탐지
 * - 상세 분석 결과 시각화
 */

import { useState, useCallback, useEffect } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  Shield,
  Search,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HelpCircle,
  Scale,
  ExternalLink,
  FileText,
  Link as LinkIcon,
  Brain,
  Sparkles,
  BarChart3,
  Copy,
  Download,
  RefreshCw,
  Info,
  ChevronDown,
  ChevronUp,
  Clock,
  Target,
  Layers,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { FactCheckAnalyticsPanel, type FactCheckAnalytics } from "@/components/FactCheckAnalyticsPanel";
import { useFactCheckAnalytics, generateMockAnalytics } from "@/hooks/useFactCheckAnalytics";
import { useFactCheckChat } from "@/hooks/useFactCheckChat";
import { useFactCheckStorage } from "@/hooks/useFactCheckStorage";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { extractClaimsFromUrl, API_BASE_URL } from "@/lib/api";

// ============================================
// Types
// ============================================

interface Claim {
  id: string;
  text: string;
  source?: string;
  confidence: number;
}

interface VerificationResult {
  claimId: string;
  claim: string;
  verdict: "verified" | "false" | "unverified" | "misleading" | "partially_true";
  confidence: number;
  evidence: Evidence[];
  explanation: string;
}

interface Evidence {
  title: string;
  url: string;
  snippet: string;
  source: string;
  stance: "supporting" | "contradicting" | "neutral";
  relevanceScore: number;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  phase?: string;
  evidence?: Evidence[];
  verificationResult?: VerificationResult;
}

// ============================================
// Helper Components
// ============================================

const VerdictBadge = ({ verdict }: { verdict: VerificationResult["verdict"] }) => {
  const config = {
    verified: { 
      icon: CheckCircle2, 
      label: "검증됨", 
      class: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" 
    },
    false: { 
      icon: XCircle, 
      label: "거짓", 
      class: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" 
    },
    unverified: { 
      icon: HelpCircle, 
      label: "검증 불가", 
      class: "bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-400" 
    },
    misleading: { 
      icon: AlertTriangle, 
      label: "오해의 소지", 
      class: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400" 
    },
    partially_true: { 
      icon: Scale, 
      label: "부분적 사실", 
      class: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" 
    },
  };
  
  const { icon: Icon, label, class: className } = config[verdict];
  
  return (
    <Badge className={className}>
      <Icon className="h-3 w-3 mr-1" />
      {label}
    </Badge>
  );
};

const StanceBadge = ({ stance }: { stance: Evidence["stance"] }) => {
  const config = {
    supporting: { label: "지지", class: "bg-green-100 text-green-700" },
    contradicting: { label: "반박", class: "bg-red-100 text-red-700" },
    neutral: { label: "중립", class: "bg-gray-100 text-gray-700" },
  };
  
  const { label, class: className } = config[stance];
  return <Badge variant="outline" className={className}>{label}</Badge>;
};

// ============================================
// Main Component
// ============================================

export default function FactCheck() {
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  
  // Input states
  const [inputType, setInputType] = useState<"text" | "url">("text");
  const [inputText, setInputText] = useState("");
  const [inputUrl, setInputUrl] = useState("");
  const [sourceName, setSourceName] = useState("");
  
  // Analysis states
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [verificationResults, setVerificationResults] = useState<VerificationResult[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [currentPhase, setCurrentPhase] = useState<string>("");
  
  // Analytics from hook
  const { 
    analytics, 
    analyzeContent, 
    analyzeFromBackend, 
    isAnalyzing: isAnalyzingHook, 
    error: analyticsError 
  } = useFactCheckAnalytics();
  
  // FactCheck chat for streaming
  const { 
    sendMessage, 
    isConnected, 
    isStreaming, 
    sessionId 
  } = useFactCheckChat({
    onMessage: (event) => {
      const newMessage: ChatMessage = {
        id: `${Date.now()}-${Math.random()}`,
        role: event.role as ChatMessage["role"],
        content: event.content,
        timestamp: event.timestamp || Date.now(),
        phase: event.phase,
        evidence: event.evidence,
        verificationResult: event.verificationResult,
      };
      
      setChatMessages(prev => [...prev, newMessage]);
      
      if (event.phase) {
        setCurrentPhase(event.phase);
      }
      
      if (event.verificationResult) {
        setVerificationResults(prev => [...prev, event.verificationResult as VerificationResult]);
      }
    },
    onError: (error) => {
      toast({
        title: "오류 발생",
        description: error,
        variant: "destructive",
      });
      setIsAnalyzing(false);
    },
    onComplete: () => {
      setIsAnalyzing(false);
      setCurrentPhase("");
    },
  });
  
  // Storage hook for saving results
  const { saveResult, savedResults } = useFactCheckStorage();
  
  // Handle URL from route state or params
  useEffect(() => {
    const urlParam = searchParams.get("url");
    const textParam = searchParams.get("text");
    
    if (urlParam) {
      setInputType("url");
      setInputUrl(urlParam);
    } else if (textParam) {
      setInputType("text");
      setInputText(textParam);
    }
    
    // Check for state from navigation
    if (location.state?.url) {
      setInputType("url");
      setInputUrl(location.state.url);
    } else if (location.state?.text) {
      setInputType("text");
      setInputText(location.state.text);
    }
  }, [searchParams, location.state]);
  
  // Extract claims from URL
  const handleExtractFromUrl = useCallback(async () => {
    if (!inputUrl.trim()) {
      toast({
        title: "URL 필요",
        description: "분석할 URL을 입력해주세요.",
        variant: "destructive",
      });
      return;
    }
    
    setIsAnalyzing(true);
    setClaims([]);
    setVerificationResults([]);
    setChatMessages([]);
    
    try {
      const result = await extractClaimsFromUrl(inputUrl);
      
      if (result.claims && result.claims.length > 0) {
        const extractedClaims: Claim[] = result.claims.map((claim, idx) => ({
          id: `claim-${idx}`,
          text: typeof claim === "string" ? claim : claim.text || claim.claim,
          source: result.source || inputUrl,
          confidence: typeof claim === "object" ? claim.confidence || 0.8 : 0.8,
        }));
        
        setClaims(extractedClaims);
        setSourceName(result.source || new URL(inputUrl).hostname);
        
        toast({
          title: "주장 추출 완료",
          description: `${extractedClaims.length}개의 주장이 추출되었습니다.`,
        });
        
        // Analyze content with backend
        if (result.content) {
          setInputText(result.content);
          await analyzeContent({
            topic: result.title || inputUrl,
            sourceName: result.source,
            content: result.content,
            title: result.title,
          });
        }
      } else {
        toast({
          title: "주장 추출 실패",
          description: "URL에서 검증 가능한 주장을 찾지 못했습니다.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("URL claim extraction failed:", error);
      toast({
        title: "추출 실패",
        description: error instanceof Error ? error.message : "URL에서 주장을 추출하는데 실패했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [inputUrl, toast, analyzeContent]);
  
  // Analyze text directly
  const handleAnalyzeText = useCallback(async () => {
    if (!inputText.trim()) {
      toast({
        title: "텍스트 필요",
        description: "분석할 텍스트를 입력해주세요.",
        variant: "destructive",
      });
      return;
    }
    
    setIsAnalyzing(true);
    setClaims([]);
    setVerificationResults([]);
    setChatMessages([]);
    
    try {
      // Run frontend analytics
      await analyzeContent({
        topic: "직접 입력 텍스트",
        sourceName: sourceName || undefined,
        content: inputText,
        title: inputText.slice(0, 100),
      });
      
      // Try to extract claims from text using backend
      const response = await fetch(`${API_BASE_URL}/api/ml-addons/factcheck/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: `fc-${Date.now()}`,
          addon_id: "factcheck-v1",
          task: "article_analysis",
          article: {
            title: inputText.slice(0, 100),
            content: inputText,
            source: sourceName || "직접 입력",
          },
          options: {
            analysis_mode: "hybrid",
            include_detailed_analytics: true,
          },
        }),
      });
      
      if (response.ok) {
        const result = await response.json();
        
        if (result.results?.factcheck?.claims) {
          const extractedClaims: Claim[] = result.results.factcheck.claims.map((claim: any, idx: number) => ({
            id: `claim-${idx}`,
            text: claim.text || claim.claim_text,
            confidence: claim.confidence || 0.7,
          }));
          setClaims(extractedClaims);
        }
        
        // Convert backend analytics if available
        if (result.results?.factcheck?.detailed_analytics) {
          await analyzeFromBackend(result);
        }
        
        toast({
          title: "분석 완료",
          description: "팩트체크 분석이 완료되었습니다.",
        });
      }
    } catch (error) {
      console.error("Text analysis failed:", error);
      // Still show the frontend analytics even if backend fails
      toast({
        title: "부분 분석 완료",
        description: "일부 분석이 완료되었습니다. 백엔드 연결을 확인해주세요.",
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [inputText, sourceName, toast, analyzeContent, analyzeFromBackend]);
  
  // Verify a specific claim
  const handleVerifyClaim = useCallback(async (claim: Claim) => {
    if (!isConnected) {
      toast({
        title: "연결 안됨",
        description: "팩트체크 서비스에 연결되지 않았습니다.",
        variant: "destructive",
      });
      return;
    }
    
    setIsAnalyzing(true);
    
    try {
      await sendMessage(`다음 주장을 검증해주세요: "${claim.text}"`, [claim.text]);
    } catch (error) {
      console.error("Claim verification failed:", error);
      toast({
        title: "검증 실패",
        description: "주장 검증에 실패했습니다.",
        variant: "destructive",
      });
      setIsAnalyzing(false);
    }
  }, [isConnected, sendMessage, toast]);
  
  // Save current result
  const handleSaveResult = useCallback(async () => {
    if (!analytics && claims.length === 0) {
      toast({
        title: "저장할 결과 없음",
        description: "먼저 분석을 실행해주세요.",
        variant: "destructive",
      });
      return;
    }
    
    try {
      await saveResult({
        topic: inputUrl || inputText.slice(0, 100),
        summary: analytics ? `신뢰도 등급: ${analytics.scoreBreakdown.grade}` : "분석 완료",
        items: claims.map(c => ({
          title: c.text,
          url: inputUrl || undefined,
          source: c.source,
        })),
        score: analytics?.scoreBreakdown.totalScore,
      });
      
      toast({
        title: "저장 완료",
        description: "팩트체크 결과가 저장되었습니다.",
      });
    } catch (error) {
      toast({
        title: "저장 실패",
        description: "결과 저장에 실패했습니다.",
        variant: "destructive",
      });
    }
  }, [analytics, claims, inputUrl, inputText, saveResult, toast]);
  
  // Copy results to clipboard
  const handleCopyResults = useCallback(() => {
    const text = [
      `## 팩트체크 결과`,
      ``,
      `**분석 대상:** ${inputUrl || inputText.slice(0, 100)}`,
      `**출처:** ${sourceName || "알 수 없음"}`,
      ``,
      analytics ? [
        `### 신뢰도 분석`,
        `- 종합 등급: ${analytics.scoreBreakdown.grade}`,
        `- 종합 점수: ${analytics.scoreBreakdown.totalScore.toFixed(1)}점`,
        `- 출처 신뢰도: ${Math.round(analytics.sourceAnalysis.trustScore * 100)}%`,
        `- 클릭베이트 점수: ${Math.round(analytics.clickbaitAnalysis.score * 100)}%`,
        ``,
      ].join("\n") : "",
      claims.length > 0 ? [
        `### 추출된 주장 (${claims.length}개)`,
        ...claims.map((c, i) => `${i + 1}. ${c.text}`),
        ``,
      ].join("\n") : "",
      verificationResults.length > 0 ? [
        `### 검증 결과`,
        ...verificationResults.map(r => `- ${r.claim}: ${r.verdict}`),
      ].join("\n") : "",
    ].filter(Boolean).join("\n");
    
    navigator.clipboard.writeText(text);
    toast({
      title: "복사 완료",
      description: "결과가 클립보드에 복사되었습니다.",
    });
  }, [inputUrl, inputText, sourceName, analytics, claims, verificationResults, toast]);
  
  return (
    <TooltipProvider>
      <div className="container mx-auto p-4 md:p-6 max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">팩트체크</h1>
              <p className="text-sm text-muted-foreground">
                ML 기반 뉴스 신뢰도 분석 및 주장 검증
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Badge variant={isConnected ? "default" : "secondary"}>
              {isConnected ? "연결됨" : "연결 대기"}
            </Badge>
            {sessionId && (
              <Badge variant="outline" className="text-xs">
                세션: {sessionId.slice(0, 8)}...
              </Badge>
            )}
          </div>
        </div>
        
        {/* Input Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Search className="h-5 w-5" />
              분석 입력
            </CardTitle>
            <CardDescription>
              URL 또는 텍스트를 입력하여 팩트체크를 시작하세요
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Input Type Selector */}
            <Tabs value={inputType} onValueChange={(v) => setInputType(v as "text" | "url")}>
              <TabsList className="grid w-full grid-cols-2 max-w-md">
                <TabsTrigger value="url" className="flex items-center gap-2">
                  <LinkIcon className="h-4 w-4" />
                  URL 분석
                </TabsTrigger>
                <TabsTrigger value="text" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  텍스트 분석
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="url" className="space-y-3 mt-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="https://news.example.com/article/..."
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    className="flex-1"
                  />
                  <Button 
                    onClick={handleExtractFromUrl} 
                    disabled={isAnalyzing || !inputUrl.trim()}
                  >
                    {isAnalyzing ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Search className="h-4 w-4 mr-2" />
                    )}
                    분석
                  </Button>
                </div>
              </TabsContent>
              
              <TabsContent value="text" className="space-y-3 mt-4">
                <div className="space-y-3">
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <Label htmlFor="source-name">출처명 (선택)</Label>
                      <Input
                        id="source-name"
                        placeholder="예: 연합뉴스, 조선일보 등"
                        value={sourceName}
                        onChange={(e) => setSourceName(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="content">분석할 내용</Label>
                    <Textarea
                      id="content"
                      placeholder="뉴스 기사 본문 또는 검증하고 싶은 주장을 입력하세요..."
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      rows={6}
                      className="mt-1"
                    />
                  </div>
                  <Button 
                    onClick={handleAnalyzeText}
                    disabled={isAnalyzing || !inputText.trim()}
                    className="w-full sm:w-auto"
                  >
                    {isAnalyzing ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Brain className="h-4 w-4 mr-2" />
                    )}
                    AI 분석 시작
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
            
            {/* Progress Indicator */}
            {isAnalyzing && currentPhase && (
              <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-sm">{currentPhase}</span>
              </div>
            )}
          </CardContent>
        </Card>
        
        {/* Results Section */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Claims Panel */}
          <div className="lg:col-span-1 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-lg">
                  <span className="flex items-center gap-2">
                    <Target className="h-5 w-5" />
                    추출된 주장
                  </span>
                  <Badge variant="secondary">{claims.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {claims.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <HelpCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>분석을 시작하면 주장이 추출됩니다</p>
                  </div>
                ) : (
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-3">
                      {claims.map((claim, index) => (
                        <Card key={claim.id} className="bg-muted/50">
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <p className="text-sm font-medium mb-1">
                                  {index + 1}. {claim.text}
                                </p>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Badge variant="outline" className="text-xs">
                                    신뢰도: {Math.round(claim.confidence * 100)}%
                                  </Badge>
                                  {claim.source && (
                                    <span className="truncate max-w-[150px]">{claim.source}</span>
                                  )}
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleVerifyClaim(claim)}
                                disabled={isAnalyzing || !isConnected}
                              >
                                <Shield className="h-3 w-3" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
            
            {/* Verification Results */}
            {verificationResults.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <CheckCircle2 className="h-5 w-5" />
                    검증 결과
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[300px]">
                    <div className="space-y-3">
                      {verificationResults.map((result) => (
                        <Card key={result.claimId} className="bg-muted/50">
                          <CardContent className="p-3">
                            <div className="space-y-2">
                              <div className="flex items-start justify-between">
                                <p className="text-sm font-medium flex-1">{result.claim}</p>
                                <VerdictBadge verdict={result.verdict} />
                              </div>
                              <p className="text-xs text-muted-foreground">{result.explanation}</p>
                              <Progress value={result.confidence * 100} className="h-1" />
                              <span className="text-xs text-muted-foreground">
                                신뢰도: {Math.round(result.confidence * 100)}%
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
          </div>
          
          {/* Analytics Panel */}
          <div className="lg:col-span-2 space-y-4">
            {/* Action Buttons */}
            {(analytics || claims.length > 0) && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleCopyResults}>
                  <Copy className="h-4 w-4 mr-2" />
                  복사
                </Button>
                <Button variant="outline" size="sm" onClick={handleSaveResult}>
                  <Download className="h-4 w-4 mr-2" />
                  저장
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => {
                    setClaims([]);
                    setVerificationResults([]);
                    setChatMessages([]);
                  }}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  초기화
                </Button>
              </div>
            )}
            
            {/* Analytics Panel */}
            <FactCheckAnalyticsPanel 
              analytics={analytics} 
              isLoading={isAnalyzingHook} 
            />
            
            {/* Chat Messages (if any) */}
            {chatMessages.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Sparkles className="h-5 w-5" />
                    AI 분석 로그
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[300px]">
                    <div className="space-y-3">
                      {chatMessages.map((msg) => (
                        <div 
                          key={msg.id}
                          className={`p-3 rounded-lg ${
                            msg.role === "user" 
                              ? "bg-primary/10 ml-8" 
                              : msg.role === "system"
                              ? "bg-muted/50 border-l-2 border-yellow-500"
                              : "bg-muted/50 mr-8"
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="text-xs">
                              {msg.role === "user" ? "사용자" : msg.role === "system" ? "시스템" : "AI"}
                            </Badge>
                            {msg.phase && (
                              <Badge variant="secondary" className="text-xs">
                                {msg.phase}
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {new Date(msg.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          <MarkdownRenderer content={msg.content} />
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
            
            {/* Empty State */}
            {!analytics && claims.length === 0 && !isAnalyzing && (
              <Card className="border-dashed">
                <CardContent className="py-12">
                  <div className="text-center text-muted-foreground">
                    <BarChart3 className="h-16 w-16 mx-auto mb-4 opacity-50" />
                    <h3 className="text-lg font-medium mb-2">분석 결과 대기 중</h3>
                    <p className="text-sm max-w-md mx-auto">
                      URL 또는 텍스트를 입력하고 분석을 시작하면
                      출처 신뢰도, 클릭베이트 감지, 허위정보 위험도 등
                      상세한 분석 결과가 표시됩니다.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
        
        {/* Info Section */}
        <Card className="bg-muted/30">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="text-sm text-muted-foreground">
                <p className="font-medium mb-1">팩트체크 분석 방법</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>KoELECTRA, KLUE BERT 등 한국어 특화 ML 모델 사용</li>
                  <li>출처 신뢰도 데이터베이스 기반 교차 검증</li>
                  <li>클릭베이트 패턴 및 허위정보 신호 탐지</li>
                  <li>의미론적 유사도 기반 주장-증거 매칭</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
