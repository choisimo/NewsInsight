import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Server,
  Play,
  Square,
  RotateCcw,
  Trash2,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Terminal,
} from 'lucide-react';
import { environmentsApi } from '@/lib/adminApi';
import type { Environment, EnvironmentStatus, ContainerInfo } from '@/types/admin';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

export default function AdminEnvironments() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedEnv, setSelectedEnv] = useState<Environment | null>(null);
  const [status, setStatus] = useState<EnvironmentStatus | null>(null);
  const [logs, setLogs] = useState<string>('');
  const [selectedService, setSelectedService] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [actionOutput, setActionOutput] = useState<string>('');
  
  // TODO: Add Auth Context check for role-based access if needed
  // const { user } = useAuth();
  // const isOperator = user?.role === 'operator' || user?.role === 'admin';
  // const isAdmin = user?.role === 'admin';
  const isOperator = true; // Temporary bypass
  const isAdmin = true; // Temporary bypass

  useEffect(() => {
    loadEnvironments();
  }, []);

  useEffect(() => {
    const selectedId = searchParams.get('selected');
    if (selectedId && environments.length > 0) {
      const env = environments.find((e) => e.id === selectedId);
      if (env) {
        setSelectedEnv(env);
        loadStatus(env.id);
      }
    }
  }, [searchParams, environments]);

  const loadEnvironments = async () => {
    try {
      const envs = await environmentsApi.list();
      setEnvironments(envs);
      
      if (envs.length > 0 && !searchParams.get('selected')) {
        setSelectedEnv(envs[0]);
        loadStatus(envs[0].id);
      }
    } catch (error) {
      console.error('Failed to load environments:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadStatus = async (envId: string) => {
    try {
      const statusData = await environmentsApi.getStatus(envId);
      setStatus(statusData);
    } catch (error) {
      console.error('Failed to load status:', error);
      setStatus(null);
    }
  };

  const selectEnvironment = (env: Environment) => {
    setSelectedEnv(env);
    setSearchParams({ selected: env.id });
    setLogs('');
    setActionOutput('');
    loadStatus(env.id);
  };

  const handleAction = async (
    action: 'up' | 'down' | 'restart' | 'cleanup',
    service?: string
  ) => {
    if (!selectedEnv) return;

    // Confirm dangerous actions
    if (action === 'cleanup') {
      if (!confirm('⚠️ 전체 정리를 진행하면 데이터베이스 볼륨도 삭제됩니다. 계속하시겠습니까?')) {
        return;
      }
    }

    setIsActionLoading(true);
    setActionOutput('');

    try {
      // Note: The return types from adminApi might need adjustment based on backend response
      // Assuming void or simple object response for now
      switch (action) {
        case 'up':
          await environmentsApi.up(selectedEnv.id, true);
          break;
        case 'down':
          await environmentsApi.down(selectedEnv.id, false);
          break;
        case 'restart':
          await environmentsApi.restart(selectedEnv.id, service);
          break;
        case 'cleanup':
          await environmentsApi.down(selectedEnv.id, true);
          break;
      }
      setActionOutput(`Action ${action} completed successfully`);
      await loadStatus(selectedEnv.id);
    } catch (error) {
      setActionOutput(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const loadServiceLogs = async (service: string) => {
    if (!selectedEnv) return;
    setSelectedService(service);
    
    try {
      const result = await environmentsApi.logs(selectedEnv.id, service, 200);
      setLogs(result.logs);
    } catch (error) {
      setLogs(`Error loading logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const getStatusIcon = (container: ContainerInfo) => {
    if (container.status === 'up') {
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    } else if (container.status === 'down') {
      return <XCircle className="w-4 h-4 text-red-500" />;
    }
    return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
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
        <h1 className="text-3xl font-bold tracking-tight">환경 관리</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Environment List */}
        <div className="lg:col-span-1 space-y-2">
          {environments.map((env) => (
            <Button
              key={env.id}
              variant={selectedEnv?.id === env.id ? "default" : "outline"}
              className="w-full justify-start h-auto py-3 px-4"
              onClick={() => selectEnvironment(env)}
            >
              <div className="flex items-center gap-3 w-full">
                <Server className="w-5 h-5 shrink-0" />
                <div className="text-left overflow-hidden">
                  <p className="font-medium truncate">{env.name}</p>
                  <p className="text-xs opacity-70 truncate">{env.env_type}</p>
                </div>
              </div>
            </Button>
          ))}
        </div>

        {/* Environment Details */}
        <div className="lg:col-span-3 space-y-6">
          {selectedEnv ? (
            <>
              {/* Actions */}
              <Card>
                <CardHeader>
                  <CardTitle>{selectedEnv.name} 환경</CardTitle>
                  <CardDescription>{selectedEnv.description || selectedEnv.compose_file}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-3 mb-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAction('up')}
                      disabled={!isOperator || isActionLoading}
                      className="bg-green-600/10 hover:bg-green-600/20 text-green-600 border-green-200"
                    >
                      <Play className="w-4 h-4 mr-2" />
                      시작
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAction('down')}
                      disabled={!isOperator || isActionLoading}
                      className="bg-yellow-600/10 hover:bg-yellow-600/20 text-yellow-600 border-yellow-200"
                    >
                      <Square className="w-4 h-4 mr-2" />
                      중지
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAction('restart')}
                      disabled={!isOperator || isActionLoading}
                      className="bg-blue-600/10 hover:bg-blue-600/20 text-blue-600 border-blue-200"
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      재시작
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleAction('cleanup')}
                      disabled={!isAdmin || isActionLoading}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      전체 정리
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => loadStatus(selectedEnv.id)}
                      disabled={isActionLoading}
                    >
                      <RefreshCw className={`w-4 h-4 mr-2 ${isActionLoading ? 'animate-spin' : ''}`} />
                      새로고침
                    </Button>
                  </div>

                  {actionOutput && (
                    <div className="mt-4 p-4 bg-muted rounded-md text-sm font-mono overflow-x-auto max-h-48">
                      {actionOutput}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Container Status */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg font-medium">
                    컨테이너 상태
                    {status && (
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        ({status.running_containers}/{status.total_containers} 실행 중)
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="divide-y">
                    {status?.containers && status.containers.length > 0 ? (
                      status.containers.map((container) => (
                        <div
                          key={container.name}
                          className="flex items-center justify-between py-3"
                        >
                          <div className="flex items-center gap-3">
                            {getStatusIcon(container)}
                            <div>
                              <p className="text-sm font-medium">
                                {container.name}
                              </p>
                              <p className="text-xs text-muted-foreground">{container.image}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={container.status === 'up' ? 'default' : 'secondary'} className={
                                container.status === 'up' ? 'bg-green-500/10 text-green-600 hover:bg-green-500/20' : 
                                container.status === 'down' ? 'bg-red-500/10 text-red-600 hover:bg-red-500/20' : ''
                            }>
                              {container.status}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => loadServiceLogs(container.name.replace('newsinsight-', ''))}
                              title="로그 보기"
                              className="h-8 w-8"
                            >
                              <Terminal className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="py-8 text-center text-muted-foreground">
                        컨테이너 정보가 없습니다
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Logs */}
              {logs && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-base font-medium">
                      로그: {selectedService}
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setLogs('')}
                    >
                      닫기
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-96 w-full rounded-md border bg-muted p-4">
                      <pre className="text-xs font-mono whitespace-pre-wrap">
                        {logs}
                      </pre>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card className="h-64 flex items-center justify-center text-muted-foreground">
              환경을 선택해주세요
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
