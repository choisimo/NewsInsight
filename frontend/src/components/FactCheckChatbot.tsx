import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Bot, User, AlertCircle, CheckCircle2, XCircle, Scale, Shield } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useFactCheckChat } from '@/hooks/useFactCheckChat';

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

export const FactCheckChatbot = () => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { sendMessage, isConnected, isStreaming, sessionId } = useFactCheckChat({
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

  // 자동 스크롤
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    await sendMessage(input);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] max-w-5xl mx-auto">
      <Card className="flex-1 flex flex-col">
        <CardHeader className="border-b">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle>팩트체크 챗봇</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                궁금한 주장이나 뉴스를 입력하면 실시간으로 팩트체크 결과를 제공합니다
              </p>
            </div>
            {isConnected && (
              <Badge variant="outline" className="ml-auto">
                <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse" />
                연결됨
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="flex-1 flex flex-col p-0">
          {/* 메시지 영역 */}
          <ScrollArea ref={scrollRef} className="flex-1 p-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Bot className="h-16 w-16 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">팩트체크 챗봇에 오신 것을 환영합니다!</h3>
                <p className="text-muted-foreground max-w-md">
                  검증하고 싶은 주장이나 뉴스를 입력해주세요. 
                  신뢰할 수 있는 출처를 기반으로 실시간 팩트체크를 수행합니다.
                </p>
                <div className="mt-6 grid grid-cols-1 gap-2 w-full max-w-md">
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
};

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
