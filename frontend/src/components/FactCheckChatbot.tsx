import { useState, useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Send, Loader2, Bot, User, AlertCircle, CheckCircle2, XCircle, Scale, Shield, Download, Copy, Check, FileText, FileCode, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useFactCheckChat } from '@/hooks/useFactCheckChat';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

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
  const initialSentRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { sendMessage, isConnected, isStreaming, sessionId, reconnect } = useFactCheckChat({
    onMessage: (event) => {
      setMessages((prev) => [...prev, {
        id: `${Date.now()}-${Math.random()}`,
        role: event.role as 'user' | 'assistant' | 'system',
        content: event.content || '',
        timestamp: event.timestamp || Date.now(),
        type: event.type,
        phase: event.phase,
        evidence: event.evidence,
        verificationResult: event.verificationResult,
        credibility: event.credibility,
      }]);
    },
    onError: (error) => {
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
    reconnect();
  }, [reconnect]);

  // 자동 스크롤
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Helper function to send a query
  const sendQueryInternal = async (query: string) => {
    if (!query.trim() || isStreaming) return;

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

  return (
    <div className={`flex flex-col ${containerHeightClass} ${compact ? '' : 'max-w-5xl mx-auto'}`}>
      <Card className="flex-1 flex flex-col">
        {!hideHeader && (
          <CardHeader className={`border-b ${compact ? 'py-3' : ''}`}>
            <div className="flex items-center gap-3">
              <div className={`${compact ? 'p-1.5' : 'p-2'} bg-primary/10 rounded-lg`}>
                <Shield className={`${compact ? 'h-5 w-5' : 'h-6 w-6'} text-primary`} />
              </div>
              <div>
                <CardTitle className={compact ? 'text-base' : ''}>팩트체크 챗봇</CardTitle>
                {!compact && (
                  <p className="text-sm text-muted-foreground mt-1">
                    궁금한 주장이나 뉴스를 입력하면 실시간으로 팩트체크 결과를 제공합니다
                  </p>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2">
                {/* Export Menu */}
                {messages.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size={compact ? 'sm' : 'default'}>
                        <Download className="h-4 w-4 mr-1" />
                        내보내기
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>내보내기 형식</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={exportToMarkdown}>
                        <FileCode className="h-4 w-4 mr-2 text-blue-600" />
                        Markdown (.md)
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={exportToText}>
                        <FileText className="h-4 w-4 mr-2 text-gray-600" />
                        텍스트 (.txt)
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={exportToJson}>
                        <FileText className="h-4 w-4 mr-2 text-yellow-600" />
                        JSON (.json)
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={copyToClipboard}>
                        {copied ? (
                          <Check className="h-4 w-4 mr-2 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4 mr-2" />
                        )}
                        클립보드 복사
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {isConnected && (
                  <Badge variant="outline">
                    <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse" />
                    연결됨
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
        )}

        <CardContent className="flex-1 flex flex-col p-0 min-h-0">
          {/* 메시지 영역 */}
          <ScrollArea ref={scrollRef} className="flex-1 p-4">
            {/* 연결 오류 상태 */}
            {!isConnected && messages.length === 0 ? (
              <div className={`flex flex-col items-center justify-center h-full text-center ${compact ? 'p-4' : 'p-8'}`}>
                <AlertCircle className={`${compact ? 'h-12 w-12' : 'h-16 w-16'} text-destructive mb-4`} />
                <h3 className={`${compact ? 'text-base' : 'text-lg'} font-semibold mb-2`}>
                  세션 연결 중...
                </h3>
                <p className={`text-muted-foreground ${compact ? 'text-sm' : ''} max-w-md mb-4`}>
                  팩트체크 서버에 연결하고 있습니다. 잠시만 기다려주세요.
                </p>
                <Button onClick={handleReconnect} variant="outline" size="sm">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  다시 연결
                </Button>
              </div>
            ) : messages.length === 0 ? (
              <div className={`flex flex-col items-center justify-center h-full text-center ${compact ? 'p-4' : 'p-8'}`}>
                <Bot className={`${compact ? 'h-12 w-12' : 'h-16 w-16'} text-muted-foreground mb-4`} />
                <h3 className={`${compact ? 'text-base' : 'text-lg'} font-semibold mb-2`}>
                  {compact ? '팩트체크를 시작하세요' : '팩트체크 챗봇에 오신 것을 환영합니다!'}
                </h3>
                <p className={`text-muted-foreground ${compact ? 'text-sm' : ''} max-w-md`}>
                  검증하고 싶은 주장이나 뉴스를 입력해주세요. 
                  {!compact && '신뢰할 수 있는 출처를 기반으로 실시간 팩트체크를 수행합니다.'}
                </p>
                <div className={`${compact ? 'mt-4' : 'mt-6'} grid grid-cols-1 gap-2 w-full max-w-md`}>
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() => setInput('메모리 반도체 가격이 상승하고 있다는 뉴스가 사실인가요?')}
                  >
                    💡 메모리 반도체 가격 상승 뉴스 검증
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() => setInput('최근 발표된 경제 성장률 통계가 정확한가요?')}
                  >
                    📊 경제 통계 검증
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() => setInput('이 정치인의 발언이 사실에 부합하나요?')}
                  >
                    🎤 정치인 발언 검증
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
                {isStreaming && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">분석 중...</span>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          {/* 입력 영역 */}
          <div className="border-t p-4">
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="팩트체크할 내용을 입력하세요..."
                disabled={isStreaming}
                className="flex-1"
              />
              <Button
                onClick={handleSend}
                disabled={!input.trim() || isStreaming}
                size="icon"
              >
                {isStreaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Enter로 전송 • Shift+Enter로 줄바꿈
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
});

// 메시지 버블 컴포넌트
const MessageBubble = ({ message }: { message: Message }) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  // 시스템 메시지 (상태 업데이트)
  if (isSystem && message.type === 'status') {
    return (
      <div className="flex justify-center">
        <Badge variant="secondary" className="text-xs">
          {message.content}
        </Badge>
      </div>
    );
  }

  // 증거 메시지
  if (message.type === 'evidence' && message.evidence) {
    return (
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
            <Shield className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
        </div>
        <div className="flex-1">
          <Alert>
            <AlertDescription>
              <p className="font-medium mb-2">{message.content}</p>
              <div className="space-y-2 mt-3">
                {message.evidence.slice(0, 3).map((ev: any, idx: number) => (
                  <div key={idx} className="text-sm border-l-2 border-primary pl-3">
                    <p className="font-medium">{ev.sourceName}</p>
                    <p className="text-muted-foreground text-xs mt-1">{ev.excerpt}</p>
                  </div>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  // 검증 결과 메시지
  if (message.type === 'verification' && message.verificationResult) {
    const result = message.verificationResult;
    const statusIcon = getVerificationIcon(result.status);
    
    return (
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center">
            {statusIcon}
          </div>
        </div>
        <div className="flex-1">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between mb-2">
                <p className="font-medium">{result.originalClaim}</p>
                <Badge variant={getVerificationVariant(result.status)}>
                  {getVerificationLabel(result.status)}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{result.verificationSummary}</p>
              {result.confidenceScore && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>신뢰도</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${result.confidenceScore * 100}%` }}
                      />
                    </div>
                    <span>{Math.round(result.confidenceScore * 100)}%</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // AI 합성 메시지 (스트리밍)
  if (message.type === 'ai_synthesis') {
    return (
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <Bot className="h-4 w-4 text-white" />
          </div>
        </div>
        <div className="flex-1 bg-muted/50 rounded-lg p-4">
          <MarkdownRenderer content={message.content} isStreaming={true} />
        </div>
      </div>
    );
  }

  // 완료 메시지
  if (message.type === 'complete') {
    return (
      <div className="flex justify-center">
        <Alert className="max-w-md">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>{message.content}</AlertDescription>
        </Alert>
      </div>
    );
  }

  // 에러 메시지
  if (message.type === 'error') {
    return (
      <div className="flex justify-center">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{message.content}</AlertDescription>
        </Alert>
      </div>
    );
  }

  // 일반 사용자/어시스턴트 메시지
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className="flex-shrink-0">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
          isUser 
            ? 'bg-primary text-primary-foreground' 
            : 'bg-muted'
        }`}>
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </div>
      </div>
      <div className={`flex-1 max-w-[80%] ${isUser ? 'text-right' : ''}`}>
        <div className={`inline-block rounded-lg p-3 ${
          isUser 
            ? 'bg-primary text-primary-foreground' 
            : 'bg-muted'
        }`}>
          {message.content.includes('\n') || message.content.length > 100 ? (
            <MarkdownRenderer content={message.content} isStreaming={false} />
          ) : (
            <p className="text-sm">{message.content}</p>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
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
const getVerificationIcon = (status: string) => {
  switch (status) {
    case 'VERIFIED':
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    case 'FALSE':
      return <XCircle className="h-4 w-4 text-red-600" />;
    case 'DISPUTED':
      return <Scale className="h-4 w-4 text-orange-600" />;
    default:
      return <AlertCircle className="h-4 w-4 text-gray-600" />;
  }
};

const getVerificationVariant = (status: string): 'default' | 'destructive' | 'outline' | 'secondary' => {
  switch (status) {
    case 'VERIFIED':
      return 'default';
    case 'FALSE':
      return 'destructive';
    case 'DISPUTED':
      return 'secondary';
    default:
      return 'outline';
  }
};

const getVerificationLabel = (status: string) => {
  switch (status) {
    case 'VERIFIED':
      return '검증됨';
    case 'FALSE':
      return '거짓';
    case 'DISPUTED':
      return '논쟁 중';
    case 'UNVERIFIED':
      return '검증 불가';
    default:
      return status;
  }
};

// Set displayName for forwardRef
FactCheckChatbot.displayName = 'FactCheckChatbot';
