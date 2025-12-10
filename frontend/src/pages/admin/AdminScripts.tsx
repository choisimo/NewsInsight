import { useEffect, useState } from 'react';
import {
  Play,
  Terminal,
  Clock,
  AlertTriangle,
  FileText,
  RotateCcw,
  XCircle,
  CheckCircle,
  MoreVertical,
} from 'lucide-react';
import { scriptsApi, environmentsApi } from '@/lib/adminApi';
import type { Script, TaskExecution, Environment } from '@/types/admin';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

export default function AdminScripts() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedScript, setSelectedScript] = useState<Script | null>(null);
  const [showExecuteDialog, setShowExecuteDialog] = useState(false);
  const [executionParams, setExecutionParams] = useState<Record<string, any>>({});
  const [selectedEnvId, setSelectedEnvId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [scriptsData, executionsData, envsData] = await Promise.all([
        scriptsApi.list(),
        scriptsApi.listExecutions(undefined, undefined, 20),
        environmentsApi.list(true), // Only active environments
      ]);
      setScripts(scriptsData);
      setExecutions(executionsData);
      setEnvironments(envsData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!selectedScript || !selectedEnvId) return;

    try {
      await scriptsApi.execute(selectedScript.id, selectedEnvId, executionParams);
      setShowExecuteDialog(false);
      // Refresh executions list
      const newExecutions = await scriptsApi.listExecutions(undefined, undefined, 20);
      setExecutions(newExecutions);
      
      // Reset params
      setExecutionParams({});
      setSelectedEnvId('');
    } catch (error) {
      console.error('Failed to execute script:', error);
      alert('스크립트 실행 실패: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const getRiskBadge = (level: string) => {
    switch (level) {
      case 'low':
        return <Badge variant="secondary" className="bg-green-100 text-green-800">Low Risk</Badge>;
      case 'medium':
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">Medium Risk</Badge>;
      case 'high':
        return <Badge variant="destructive">High Risk</Badge>;
      case 'critical':
        return <Badge variant="destructive" className="bg-red-900">CRITICAL</Badge>;
      default:
        return <Badge variant="outline">{level}</Badge>;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'running':
        return <RotateCcw className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-gray-500" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 container mx-auto p-4">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">스크립트 & 작업</h1>
        <Button variant="outline" onClick={loadData}>
          <RotateCcw className="w-4 h-4 mr-2" />
          새로고침
        </Button>
      </div>

      <Tabs defaultValue="scripts" className="w-full">
        <TabsList>
          <TabsTrigger value="scripts">스크립트 목록</TabsTrigger>
          <TabsTrigger value="executions">실행 이력</TabsTrigger>
        </TabsList>

        <TabsContent value="scripts" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {scripts.map((script) => (
              <Card key={script.id} className="flex flex-col">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-lg">{script.name}</CardTitle>
                    {getRiskBadge(script.risk_level)}
                  </div>
                  <CardDescription className="line-clamp-2 min-h-[40px]">
                    {script.description || 'No description'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-grow">
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Terminal className="w-4 h-4" />
                      <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono truncate max-w-[200px]">
                        {script.command}
                      </code>
                    </div>
                    {script.estimated_duration && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Clock className="w-4 h-4" />
                        <span>약 {Math.ceil(script.estimated_duration / 60)}분 소요</span>
                      </div>
                    )}
                  </div>
                </CardContent>
                <CardFooter>
                  <Dialog open={showExecuteDialog && selectedScript?.id === script.id} onOpenChange={(open) => {
                    if (!open) {
                      setShowExecuteDialog(false);
                      setSelectedScript(null);
                    }
                  }}>
                    <DialogTrigger asChild>
                      <Button 
                        className="w-full" 
                        onClick={() => {
                          setSelectedScript(script);
                          setShowExecuteDialog(true);
                          // Select first allowed environment by default
                          if (environments.length > 0) {
                            setSelectedEnvId(environments[0].id);
                          }
                        }}
                      >
                        <Play className="w-4 h-4 mr-2" />
                        실행
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{script.name} 실행</DialogTitle>
                        <DialogDescription>
                          스크립트를 실행할 환경과 파라미터를 설정하세요.
                        </DialogDescription>
                      </DialogHeader>

                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label>환경 선택</Label>
                          <Select value={selectedEnvId} onValueChange={setSelectedEnvId}>
                            <SelectTrigger>
                              <SelectValue placeholder="환경 선택" />
                            </SelectTrigger>
                            <SelectContent>
                              {environments
                                .filter(env => script.allowed_environments.includes('*') || script.allowed_environments.includes(env.id))
                                .map(env => (
                                  <SelectItem key={env.id} value={env.id}>
                                    {env.name} ({env.env_type})
                                  </SelectItem>
                                ))
                              }
                            </SelectContent>
                          </Select>
                        </div>

                        {script.parameters && script.parameters.length > 0 && (
                          <div className="space-y-3 border-t pt-3">
                            <Label>파라미터 설정</Label>
                            {script.parameters.map(param => (
                              <div key={param.name} className="space-y-1">
                                <Label className="text-xs">{param.name} {param.required && <span className="text-red-500">*</span>}</Label>
                                <Input 
                                  placeholder={param.description}
                                  defaultValue={param.default as string}
                                  onChange={(e) => setExecutionParams(prev => ({
                                    ...prev,
                                    [param.name]: e.target.value
                                  }))}
                                />
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="bg-muted p-3 rounded-md text-xs font-mono">
                          <p className="font-semibold mb-1">Command Preview:</p>
                          {script.command}
                        </div>
                      </div>

                      <DialogFooter>
                        <Button variant="outline" onClick={() => setShowExecuteDialog(false)}>취소</Button>
                        <Button onClick={handleExecute} disabled={!selectedEnvId}>실행하기</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </CardFooter>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="executions" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>최근 실행 이력</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {executions.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">실행 이력이 없습니다.</p>
                ) : (
                  executions.map((exec) => (
                    <div key={exec.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="p-2 bg-muted rounded-full">
                          {getStatusIcon(exec.status)}
                        </div>
                        <div>
                          <p className="font-medium">{exec.script_name}</p>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>{exec.environment_name}</span>
                            <span>•</span>
                            <span>{formatDistanceToNow(new Date(exec.started_at), { addSuffix: true, locale: ko })}</span>
                            <span>•</span>
                            <span>{exec.executed_by}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <Badge variant="outline">{exec.status}</Badge>
                        {exec.status === 'running' || exec.status === 'pending' ? (
                          <Button variant="ghost" size="sm" onClick={() => scriptsApi.cancelExecution(exec.id)}>
                            취소
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
