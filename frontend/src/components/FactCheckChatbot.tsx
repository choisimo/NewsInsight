import { useState, useRef, useEffect, useImperativeHandle, forwardRef, useCallback, useMemo } from 'react';
import { 
  Send, Loader2, Bot, User, AlertCircle, CheckCircle2, XCircle, Scale, Shield, 
  Download, Copy, Check, FileText, FileCode, RefreshCw, Sparkles, Search,
  ExternalLink, BookOpen, TrendingUp, MessageSquare, Zap
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useFactCheckChat } from '@/hooks/useFactCheckChat';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  type?: string;
  phase?: string;
  evidence?: any[];
  verificationResult?: any;
  credibility?: any;
  isStreaming?: boolean;
}

interface FactCheckChatbotProps {
  /** Initial query to send when component mounts */
  initialQuery?: string;
  /** Initial claims to verify (will be combined into a query) */
  initialClaims?: string[];
  /** Compact mode for embedding in tabs */
  compact?: boolean;
  /** Custom height class (default: h-[calc(100vh-12rem)] or h-[500px] in compact mode) */
  heightClass?: string;
  /** Hide header in compact mode */
  hideHeader?: boolean;
}

export interface FactCheckChatbotRef {
  sendQuery: (query: string) => void;
  sendClaims: (claims: string[]) => void;
  clearMessages: () => void;
}

export const FactCheckChatbot = forwardRef<FactCheckChatbotRef, FactCheckChatbotProps>(({
  initialQuery,
  initialClaims,
  compact = false,
  heightClass,
  hideHeader = false,
}, ref) => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<Message | null>(null);
  const initialSentRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const streamingContentRef = useRef<string>('');

  const { sendMessage, isConnected, isStreaming, sessionId, reconnect } = useFactCheckChat({
    onMessage: (event) => {
      const eventType = event.type;
      
      // ai_synthesis 이벤트는 하나의 메시지로 누적
      if (eventType === 'ai_synthesis') {
        streamingContentRef.current += event.content || '';
        setStreamingMessage({
          id: 'streaming-message',
          role: 'assistant',
          content: streamingContentRef.current,
          timestamp: event.timestamp || Date.now(),
          type: 'ai_synthesis',
          phase: event.phase,
          isStreaming: true,
        });
        return;
      }
      
      // 스트리밍 완료 시 최종 메시지를 messages에 추가
      if (eventType === 'complete') {
        if (streamingContentRef.current) {
          setMessages((prev) => [...prev, {
            id: `ai-synthesis-${Date.now()}`,
            role: 'assistant',
            content: streamingContentRef.current,
            timestamp: Date.now(),
            type: 'ai_synthesis',
            isStreaming: false,
          }]);
          streamingContentRef.current = '';
          setStreamingMessage(null);
        }
        
        // 완료 메시지도 추가
        setMessages((prev) => [...prev, {
          id: `${Date.now()}-${Math.random()}`,
          role: event.role as 'user' | 'assistant' | 'system',
          content: event.content || '',
          timestamp: event.timestamp || Date.now(),
          type: eventType,
          phase: event.phase,
        }]);
        return;
      }
      
      // status 메시지는 건너뛰기 (별도 표시하지 않음 - 스트리밍 로딩으로 대체)
      if (eventType === 'status') {
        return;
      }
      
      // evidence, verification, assessment 등 기타 메시지는 일반적으로 추가
      setMessages((prev) => [...prev, {
        id: `${Date.now()}-${Math.random()}`,
        role: event.role as 'user' | 'assistant' | 'system',
        content: event.content || '',
        timestamp: event.timestamp || Date.now(),
        type: eventType,
        phase: event.phase,
        evidence: event.evidence,
        verificationResult: event.verificationResult,
        credibility: event.credibility,
      }]);
    },
    onError: (error) => {
      // 스트리밍 중 에러 발생 시 누적된 내용 저장
      if (streamingContentRef.current) {
        setMessages((prev) => [...prev, {
          id: `ai-synthesis-${Date.now()}`,
          role: 'assistant',
          content: streamingContentRef.current,
          timestamp: Date.now(),
          type: 'ai_synthesis',
          isStreaming: false,
        }]);
        streamingContentRef.current = '';
        setStreamingMessage(null);
      }
      
      setMessages((prev) => [...prev, {
        id: `error-${Date.now()}`,
        role: 'system',
        content: `오류: ${error}`,
        timestamp: Date.now(),
        type: 'error',
      }]);
    },
  });

  // 세션 재연결 핸들러
  const handleReconnect = useCallback(() => {
    setMessages([]);
    setStreamingMessage(null);
    streamingContentRef.current = '';
    reconnect();
  }, [reconnect]);

  // 자동 스크롤 (메시지 또는 스트리밍 메시지 변경 시)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingMessage]);

  // Helper function to send a query
  const sendQueryInternal = async (query: string) => {
    if (!query.trim() || isStreaming) return;

    // 새 메시지 전송 전 스트리밍 상태 리셋
    setStreamingMessage(null);
    streamingContentRef.current = '';

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: query,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    await sendMessage(query);
  };

  // Helper function to send claims
  const sendClaimsInternal = async (claims: string[]) => {
    const validClaims = claims.filter(c => c.trim());
    if (validClaims.length === 0) return;

    const query = validClaims.length === 1
      ? `다음 주장을 팩트체크해주세요: "${validClaims[0]}"`
      : `다음 주장들을 팩트체크해주세요:\n${validClaims.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;

    await sendQueryInternal(query);
  };

  // Expose methods via ref for parent components
  useImperativeHandle(ref, () => ({
    sendQuery: (query: string) => {
      sendQueryInternal(query);
    },
    sendClaims: (claims: string[]) => {
      sendClaimsInternal(claims);
    },
    clearMessages: () => {
      setMessages([]);
      setStreamingMessage(null);
      streamingContentRef.current = '';
    },
  }), [isStreaming, sendMessage]);

  // Handle initial query or claims on mount
  useEffect(() => {
    if (initialSentRef.current || !isConnected) return;

    if (initialClaims && initialClaims.length > 0) {
      initialSentRef.current = true;
      sendClaimsInternal(initialClaims);
    } else if (initialQuery) {
      initialSentRef.current = true;
      sendQueryInternal(initialQuery);
    }
  }, [isConnected, initialQuery, initialClaims]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;
    const query = input;
    setInput('');
    await sendQueryInternal(query);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Export functionality
  const [copied, setCopied] = useState(false);

  const exportToMarkdown = useCallback(() => {
    if (messages.length === 0) return;
    
    const timestamp = new Date().toLocaleString('ko-KR');
    let md = `# 팩트체크 결과 보고서\n\n`;
    md += `**생성 시간**: ${timestamp}\n`;
    md += `**세션 ID**: ${sessionId || 'N/A'}\n\n`;
    md += `---\n\n`;

    messages.forEach((msg) => {
      if (msg.role === 'user') {
        md += `## 사용자 질문\n\n${msg.content}\n\n`;
      } else if (msg.role === 'assistant') {
        md += `## AI 응답\n\n${msg.content}\n\n`;
        
        if (msg.verificationResult) {
          const result = msg.verificationResult;
          md += `### 검증 결과\n\n`;
          md += `- **주장**: ${result.originalClaim}\n`;
          md += `- **판정**: ${getVerificationLabel(result.status)}\n`;
          md += `- **신뢰도**: ${Math.round((result.confidenceScore || 0) * 100)}%\n`;
          md += `- **요약**: ${result.verificationSummary}\n\n`;
        }
        
        if (msg.evidence && msg.evidence.length > 0) {
          md += `### 증거 자료\n\n`;
          msg.evidence.forEach((ev: any, idx: number) => {
            md += `${idx + 1}. **${ev.sourceName}**\n`;
            md += `   - ${ev.excerpt}\n`;
            if (ev.url) md += `   - URL: ${ev.url}\n`;
            md += `\n`;
          });
        }
      }
    });

    md += `---\n\n*이 보고서는 NewsInsight 팩트체크 챗봇에 의해 자동 생성되었습니다.*\n`;

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `팩트체크_결과_${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Markdown 파일이 다운로드되었습니다.');
  }, [messages, sessionId]);

  const exportToText = useCallback(() => {
    if (messages.length === 0) return;
    
    const timestamp = new Date().toLocaleString('ko-KR');
    let text = `팩트체크 결과 보고서\n`;
    text += `========================================\n\n`;
    text += `생성 시간: ${timestamp}\n`;
    text += `세션 ID: ${sessionId || 'N/A'}\n\n`;
    text += `========================================\n\n`;

    messages.forEach((msg) => {
      if (msg.role === 'user') {
        text += `[사용자 질문]\n${msg.content}\n\n`;
      } else if (msg.role === 'assistant') {
        text += `[AI 응답]\n${msg.content}\n\n`;
        
        if (msg.verificationResult) {
          const result = msg.verificationResult;
          text += `[검증 결과]\n`;
          text += `- 주장: ${result.originalClaim}\n`;
          text += `- 판정: ${getVerificationLabel(result.status)}\n`;
          text += `- 신뢰도: ${Math.round((result.confidenceScore || 0) * 100)}%\n`;
          text += `- 요약: ${result.verificationSummary}\n\n`;
        }
      }
    });

    text += `========================================\n`;
    text += `이 보고서는 NewsInsight 팩트체크 챗봇에 의해 자동 생성되었습니다.\n`;

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `팩트체크_결과_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('텍스트 파일이 다운로드되었습니다.');
  }, [messages, sessionId]);

  const exportToJson = useCallback(() => {
    if (messages.length === 0) return;
    
    const exportData = {
      exportedAt: new Date().toISOString(),
      sessionId: sessionId || null,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        type: msg.type,
        verificationResult: msg.verificationResult,
        evidence: msg.evidence,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `팩트체크_결과_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('JSON 파일이 다운로드되었습니다.');
  }, [messages, sessionId]);

  const copyToClipboard = useCallback(async () => {
    if (messages.length === 0) return;
    
    const text = messages
      .filter(m => m.role !== 'system' || m.type !== 'status')
      .map(m => {
        if (m.role === 'user') return `사용자: ${m.content}`;
        if (m.role === 'assistant') return `AI: ${m.content}`;
        return m.content;
      })
      .join('\n\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('클립보드에 복사되었습니다.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('복사에 실패했습니다.');
    }
  }, [messages]);

  // Determine height class
  const containerHeightClass = heightClass || (compact ? 'h-[500px]' : 'h-[calc(100vh-12rem)]');

  // 예시 질문들
  const exampleQuestions = useMemo(() => [
    { icon: TrendingUp, text: '메모리 반도체 가격이 상승하고 있다는 뉴스가 사실인가요?', label: '경제 뉴스' },
    { icon: BookOpen, text: '커피를 많이 마시면 건강에 해롭다는 말이 사실인가요?', label: '건강 상식' },
    { icon: Zap, text: '전기차 배터리 수명이 5년 이상 가지 않는다는게 사실인가요?', label: '기술 정보' },
  ], []);

  return (
    <TooltipProvider>
      <div className={cn(
        "flex flex-col",
        containerHeightClass,
        !compact && "max-w-4xl mx-auto"
      )}>
        <Card className="flex-1 flex flex-col overflow-hidden border-0 shadow-xl bg-gradient-to-b from-background to-muted/20">
          {/* 헤더 */}
          {!hideHeader && (
            <CardHeader className={cn(
              "border-b bg-background/80 backdrop-blur-sm",
              compact ? "py-3 px-4" : "py-4 px-6"
            )}>
              <div className="flex items-center gap-4">
                {/* 로고 영역 */}
                <div className={cn(
                  "relative",
                  compact ? "p-2" : "p-2.5"
                )}>
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl opacity-20 blur-sm" />
                  <div className="relative bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl p-2">
                    <Shield className={cn("text-white", compact ? "h-5 w-5" : "h-6 w-6")} />
                  </div>
                </div>
                
                {/* 타이틀 */}
                <div className="flex-1 min-w-0">
                  <CardTitle className={cn(
                    "flex items-center gap-2",
                    compact ? "text-base" : "text-lg"
                  )}>
                    팩트체크 AI
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                      Beta
                    </Badge>
                  </CardTitle>
                  {!compact && (
                    <p className="text-sm text-muted-foreground mt-0.5 truncate">
                      신뢰할 수 있는 출처 기반 실시간 검증
                    </p>
                  )}
                </div>
                
                {/* 액션 버튼들 */}
                <div className="flex items-center gap-2">
                  {messages.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 px-2">
                          <Download className="h-4 w-4" />
                          {!compact && <span className="ml-1.5">내보내기</span>}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuLabel className="text-xs text-muted-foreground">내보내기 형식</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={exportToMarkdown} className="gap-2">
                          <FileCode className="h-4 w-4 text-blue-500" />
                          Markdown
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={exportToText} className="gap-2">
                          <FileText className="h-4 w-4 text-gray-500" />
                          텍스트
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={exportToJson} className="gap-2">
                          <FileText className="h-4 w-4 text-amber-500" />
                          JSON
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={copyToClipboard} className="gap-2">
                          {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                          복사
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  
                  {/* 연결 상태 */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className={cn(
                        "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors",
                        isConnected 
                          ? "bg-green-500/10 text-green-600 dark:text-green-400" 
                          : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      )}>
                        <div className={cn(
                          "w-1.5 h-1.5 rounded-full",
                          isConnected ? "bg-green-500 animate-pulse" : "bg-amber-500"
                        )} />
                        {!compact && (isConnected ? "연결됨" : "연결 중")}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isConnected ? "서버 연결 활성화" : "서버에 연결 중..."}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </CardHeader>
          )}

          <CardContent className="flex-1 flex flex-col p-0 min-h-0 overflow-hidden">
            {/* 메시지 영역 */}
            <ScrollArea ref={scrollRef} className="flex-1 overflow-y-auto">
              <div className={cn("min-h-full", compact ? "p-3" : "p-4 md:p-6")}>
                {/* 연결 중 상태 */}
                {!isConnected && messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center">
                    <div className="relative mb-6">
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full opacity-20 blur-xl animate-pulse" />
                      <div className="relative bg-muted/50 rounded-full p-6">
                        <Loader2 className="h-10 w-10 text-muted-foreground animate-spin" />
                      </div>
                    </div>
                    <h3 className="text-lg font-semibold mb-2">서버에 연결 중...</h3>
                    <p className="text-muted-foreground text-sm max-w-sm mb-4">
                      팩트체크 서비스에 연결하고 있습니다
                    </p>
                    <Button onClick={handleReconnect} variant="outline" size="sm" className="gap-2">
                      <RefreshCw className="h-4 w-4" />
                      다시 연결
                    </Button>
                  </div>
                ) : messages.length === 0 ? (
                  /* 웰컴 화면 */
                  <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center">
                    <div className="relative mb-6">
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full opacity-20 blur-xl" />
                      <div className="relative bg-gradient-to-br from-blue-500/10 to-purple-600/10 rounded-full p-6 border border-primary/10">
                        <Sparkles className={cn("text-primary", compact ? "h-8 w-8" : "h-10 w-10")} />
                      </div>
                    </div>
                    
                    <h3 className={cn("font-semibold mb-2", compact ? "text-lg" : "text-xl")}>
                      무엇을 검증해 드릴까요?
                    </h3>
                    <p className="text-muted-foreground text-sm max-w-md mb-6">
                      뉴스, 주장, 상식 등 궁금한 내용을 입력하면{!compact && <br />}
                      학술 자료와 신뢰할 수 있는 출처를 기반으로 검증해 드립니다
                    </p>
                    
                    {/* 예시 질문들 */}
                    <div className="w-full max-w-md space-y-2">
                      <p className="text-xs text-muted-foreground mb-3">예시 질문</p>
                      {exampleQuestions.map((q, idx) => (
                        <button
                          key={idx}
                          onClick={() => setInput(q.text)}
                          className={cn(
                            "w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all",
                            "bg-muted/50 hover:bg-muted border border-transparent hover:border-primary/20",
                            "group"
                          )}
                        >
                          <div className="flex-shrink-0 p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                            <q.icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">{q.text}</p>
                            <p className="text-xs text-muted-foreground">{q.label}</p>
                          </div>
                          <Search className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* 메시지 목록 */
                  <div className="space-y-4">
                    {messages.map((message, idx) => (
                      <MessageBubble 
                        key={message.id} 
                        message={message} 
                        isFirst={idx === 0}
                        compact={compact}
                      />
                    ))}
                    {streamingMessage && (
                      <MessageBubble 
                        key={streamingMessage.id} 
                        message={streamingMessage}
                        compact={compact}
                      />
                    )}
                    {isStreaming && !streamingMessage && (
                      <div className="flex items-center gap-3 py-2">
                        <div className="flex-shrink-0">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                            <Bot className="h-4 w-4 text-white" />
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground bg-muted/50 rounded-full px-4 py-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="text-sm">분석 중...</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* 입력 영역 */}
            <div className={cn(
              "border-t bg-background/80 backdrop-blur-sm",
              compact ? "p-3" : "p-4"
            )}>
              <div className="flex gap-2 items-end">
                <div className="flex-1 relative">
                  <Input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="검증하고 싶은 내용을 입력하세요..."
                    disabled={isStreaming}
                    className={cn(
                      "pr-4 bg-muted/50 border-muted-foreground/20 focus-visible:ring-primary/30",
                      compact ? "h-10" : "h-11"
                    )}
                  />
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={handleSend}
                      disabled={!input.trim() || isStreaming}
                      size={compact ? "default" : "lg"}
                      className={cn(
                        "bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700",
                        "shadow-lg shadow-primary/25 transition-all",
                        compact ? "h-10 w-10" : "h-11 w-11"
                      )}
                    >
                      {isStreaming ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Enter로 전송</TooltipContent>
                </Tooltip>
              </div>
              {!compact && (
                <p className="text-[11px] text-muted-foreground mt-2 text-center">
                  학술 DB, 뉴스, 백과사전 등 다양한 출처를 실시간으로 검색하여 검증합니다
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
});

// 메시지 버블 컴포넌트
interface MessageBubbleProps {
  message: Message;
  isFirst?: boolean;
  compact?: boolean;
}

const MessageBubble = ({ message, isFirst = false, compact = false }: MessageBubbleProps) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  // 시스템 메시지 (상태 업데이트) - 숨김
  if (isSystem && message.type === 'status') {
    return null;
  }

  // 증거 메시지 - 개선된 카드 디자인
  if (message.type === 'evidence' && message.evidence) {
    return (
      <div className="flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <BookOpen className="h-4 w-4 text-white" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/50 dark:to-cyan-950/50 rounded-xl p-4 border border-blue-200/50 dark:border-blue-800/50">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                수집된 출처 ({message.evidence.length}건)
              </span>
            </div>
            <div className="space-y-2">
              {message.evidence.slice(0, 4).map((ev: any, idx: number) => (
                <div 
                  key={idx} 
                  className="bg-white/60 dark:bg-white/5 rounded-lg p-3 border border-blue-100 dark:border-blue-800/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{ev.sourceName}</p>
                    {ev.url && (
                      <a 
                        href={ev.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex-shrink-0 text-blue-500 hover:text-blue-600 transition-colors"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{ev.excerpt}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 검증 결과 메시지 - 개선된 디자인
  if (message.type === 'verification' && message.verificationResult) {
    const result = message.verificationResult;
    const statusConfig = getVerificationConfig(result.status);
    
    return (
      <div className="flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="flex-shrink-0">
          <div className={cn(
            "w-9 h-9 rounded-xl flex items-center justify-center shadow-lg",
            statusConfig.bgGradient,
            statusConfig.shadow
          )}>
            {statusConfig.icon}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className={cn(
            "rounded-xl p-4 border",
            statusConfig.cardBg,
            statusConfig.border
          )}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <p className="text-sm font-medium flex-1">{result.originalClaim}</p>
              <Badge className={cn("flex-shrink-0", statusConfig.badge)}>
                {statusConfig.label}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-3">{result.verificationSummary}</p>
            {result.confidenceScore !== undefined && (
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">신뢰도</span>
                <div className="flex-1">
                  <Progress value={result.confidenceScore * 100} className="h-2" />
                </div>
                <span className={cn("text-xs font-medium", statusConfig.textColor)}>
                  {Math.round(result.confidenceScore * 100)}%
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // AI 합성 메시지 (스트리밍) - 개선된 디자인
  if (message.type === 'ai_synthesis') {
    return (
      <div className="flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/30 dark:to-purple-950/30 rounded-xl p-4 border border-violet-200/50 dark:border-violet-800/30">
            <div className="prose prose-sm dark:prose-invert max-w-none break-words">
              <MarkdownRenderer content={message.content} isStreaming={message.isStreaming} />
            </div>
            {message.isStreaming && (
              <span className="inline-block w-2 h-4 ml-1 bg-violet-500 animate-pulse rounded-sm" />
            )}
          </div>
        </div>
      </div>
    );
  }

  // 완료 메시지
  if (message.type === 'complete') {
    return (
      <div className="flex justify-center py-2 animate-in fade-in duration-300">
        <div className="flex items-center gap-2 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 px-4 py-2 rounded-full text-sm border border-green-200/50 dark:border-green-800/30">
          <CheckCircle2 className="h-4 w-4" />
          <span>분석 완료</span>
        </div>
      </div>
    );
  }

  // 에러 메시지
  if (message.type === 'error') {
    return (
      <div className="flex justify-center py-2 animate-in fade-in duration-300">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{message.content}</AlertDescription>
        </Alert>
      </div>
    );
  }

  // 사용자 메시지
  if (isUser) {
    return (
      <div className="flex gap-3 flex-row-reverse animate-in fade-in slide-in-from-right-2 duration-300">
        <div className="flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-primary/20">
            <User className="h-4 w-4 text-white" />
          </div>
        </div>
        <div className="flex-1 min-w-0 max-w-[85%] flex flex-col items-end">
          <div className="bg-gradient-to-br from-blue-500 to-purple-600 text-white rounded-2xl rounded-tr-md px-4 py-3 shadow-lg shadow-primary/20">
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5 mr-1">
            {new Date(message.timestamp).toLocaleTimeString('ko-KR', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>
      </div>
    );
  }

  // 일반 어시스턴트 메시지
  return (
    <div className="flex gap-3 animate-in fade-in slide-in-from-left-2 duration-300">
      <div className="flex-shrink-0">
        <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
          <Bot className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
      <div className="flex-1 min-w-0 max-w-[85%]">
        <div className="bg-muted rounded-2xl rounded-tl-md px-4 py-3">
          {message.content.includes('\n') || message.content.length > 100 ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <MarkdownRenderer content={message.content} isStreaming={false} />
            </div>
          ) : (
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 ml-1">
          {new Date(message.timestamp).toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>
    </div>
  );
};

// 헬퍼 함수들
interface VerificationConfig {
  icon: React.ReactNode;
  label: string;
  bgGradient: string;
  shadow: string;
  cardBg: string;
  border: string;
  badge: string;
  textColor: string;
}

const getVerificationConfig = (status: string): VerificationConfig => {
  switch (status) {
    case 'VERIFIED':
      return {
        icon: <CheckCircle2 className="h-4 w-4 text-white" />,
        label: '검증됨',
        bgGradient: 'bg-gradient-to-br from-green-500 to-emerald-600',
        shadow: 'shadow-green-500/20',
        cardBg: 'bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30',
        border: 'border-green-200/50 dark:border-green-800/30',
        badge: 'bg-green-500 hover:bg-green-600 text-white',
        textColor: 'text-green-600 dark:text-green-400',
      };
    case 'FALSE':
      return {
        icon: <XCircle className="h-4 w-4 text-white" />,
        label: '거짓',
        bgGradient: 'bg-gradient-to-br from-red-500 to-rose-600',
        shadow: 'shadow-red-500/20',
        cardBg: 'bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/30',
        border: 'border-red-200/50 dark:border-red-800/30',
        badge: 'bg-red-500 hover:bg-red-600 text-white',
        textColor: 'text-red-600 dark:text-red-400',
      };
    case 'DISPUTED':
      return {
        icon: <Scale className="h-4 w-4 text-white" />,
        label: '논쟁 중',
        bgGradient: 'bg-gradient-to-br from-amber-500 to-orange-600',
        shadow: 'shadow-amber-500/20',
        cardBg: 'bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30',
        border: 'border-amber-200/50 dark:border-amber-800/30',
        badge: 'bg-amber-500 hover:bg-amber-600 text-white',
        textColor: 'text-amber-600 dark:text-amber-400',
      };
    case 'PARTIALLY_VERIFIED':
      return {
        icon: <AlertCircle className="h-4 w-4 text-white" />,
        label: '부분 확인',
        bgGradient: 'bg-gradient-to-br from-blue-500 to-cyan-600',
        shadow: 'shadow-blue-500/20',
        cardBg: 'bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/30 dark:to-cyan-950/30',
        border: 'border-blue-200/50 dark:border-blue-800/30',
        badge: 'bg-blue-500 hover:bg-blue-600 text-white',
        textColor: 'text-blue-600 dark:text-blue-400',
      };
    default: // UNVERIFIED
      return {
        icon: <AlertCircle className="h-4 w-4 text-white" />,
        label: '검증 불가',
        bgGradient: 'bg-gradient-to-br from-gray-400 to-slate-500',
        shadow: 'shadow-gray-400/20',
        cardBg: 'bg-gradient-to-br from-gray-50 to-slate-50 dark:from-gray-950/30 dark:to-slate-950/30',
        border: 'border-gray-200/50 dark:border-gray-800/30',
        badge: 'bg-gray-500 hover:bg-gray-600 text-white',
        textColor: 'text-gray-600 dark:text-gray-400',
      };
  }
};

const getVerificationLabel = (status: string) => {
  const config = getVerificationConfig(status);
  return config.label;
};

// Set displayName for forwardRef
FactCheckChatbot.displayName = 'FactCheckChatbot';
