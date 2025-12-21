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
  Plus,
  Pencil,
  Trash2,
} from 'lucide-react';
import { scriptsApi, environmentsApi } from '@/lib/adminApi';
import type { Script, TaskExecution, Environment } from '@/types/admin';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';

export default function AdminScripts() {
  const { toast } = useToast();
  const [scripts, setScripts] = useState<Script[]>([]);
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedScript, setSelectedScript] = useState<Script | null>(null);
  const [showExecuteDialog, setShowExecuteDialog] = useState(false);
  const [executionParams, setExecutionParams] = useState<Record<string, any>>({});
  const [selectedEnvId, setSelectedEnvId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  
  // Create/Edit script dialog states
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingScript, setEditingScript] = useState<Script | null>(null);
  const [scriptForm, setScriptForm] = useState({
    name: '',
    description: '',
    command: '',
    working_directory: '',
    risk_level: 'low' as 'low' | 'medium' | 'high' | 'critical',
    allowed_environments: ['*'],
    estimated_duration: 60,
    tags: [] as string[],
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Delete dialog states
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletingScript, setDeletingScript] = useState<Script | null>(null);

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
      
      toast({
        title: "스크립트 실행 시작",
        description: `'${selectedScript.name}' 스크립트가 실행되었습니다.`,
      });
    } catch (error) {
      console.error('Failed to execute script:', error);
      toast({
        title: "실행 실패",
        description: error instanceof Error ? error.message : '스크립트 실행에 실패했습니다.',
        variant: "destructive",
      });
    }
  };

  // Reset form for creating new script
  const openCreateDialog = () => {
    setEditingScript(null);
    setScriptForm({
      name: '',
      description: '',
      command: '',
      working_directory: '',
      risk_level: 'low',
      allowed_environments: ['*'],
      estimated_duration: 60,
      tags: [],
    });
    setShowCreateDialog(true);
  };

  // Open edit dialog with script data
  const openEditDialog = (script: Script) => {
    setEditingScript(script);
    setScriptForm({
      name: script.name,
      description: script.description || '',
      command: script.command,
      working_directory: (script as any).working_directory || '',
      risk_level: script.risk_level as 'low' | 'medium' | 'high' | 'critical',
      allowed_environments: script.allowed_environments || ['*'],
      estimated_duration: script.estimated_duration || 60,
      tags: script.tags || [],
    });
    setShowCreateDialog(true);
  };

  // Handle create or update script
  const handleSaveScript = async () => {
    if (!scriptForm.name || !scriptForm.command) {
      toast({
        title: "입력 오류",
        description: "이름과 명령어는 필수 입력 항목입니다.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingScript) {
        // Update existing script
        await scriptsApi.update(editingScript.id, scriptForm);
        toast({
          title: "스크립트 수정 완료",
          description: `'${scriptForm.name}' 스크립트가 수정되었습니다.`,
        });
      } else {
        // Create new script
        await scriptsApi.create(scriptForm);
        toast({
          title: "스크립트 등록 완료",
          description: `'${scriptForm.name}' 스크립트가 등록되었습니다.`,
        });
      }
      
      setShowCreateDialog(false);
      loadData();
    } catch (error) {
      console.error('Failed to save script:', error);
      toast({
        title: editingScript ? "수정 실패" : "등록 실패",
        description: error instanceof Error ? error.message : '스크립트 저장에 실패했습니다.',
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle delete script
  const handleDeleteScript = async () => {
    if (!deletingScript) return;

    try {
      await scriptsApi.delete(deletingScript.id);
      toast({
        title: "스크립트 삭제 완료",
        description: `'${deletingScript.name}' 스크립트가 삭제되었습니다.`,
      });
      setShowDeleteDialog(false);
      setDeletingScript(null);
      loadData();
    } catch (error) {
      console.error('Failed to delete script:', error);
      toast({
        title: "삭제 실패",
        description: error instanceof Error ? error.message : '스크립트 삭제에 실패했습니다.',
        variant: "destructive",
      });
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
        <div className="flex items-center gap-2">
          <Button onClick={openCreateDialog}>
            <Plus className="w-4 h-4 mr-2" />
            스크립트 등록
          </Button>
          <Button variant="outline" onClick={loadData}>
            <RotateCcw className="w-4 h-4 mr-2" />
            새로고침
          </Button>
        </div>
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
                <CardFooter className="flex gap-2">
                  <Dialog open={showExecuteDialog && selectedScript?.id === script.id} onOpenChange={(open) => {
                    if (!open) {
                      setShowExecuteDialog(false);
                      setSelectedScript(null);
                    }
                  }}>
                    <DialogTrigger asChild>
                      <Button 
                        className="flex-1" 
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
                  
                  {/* Edit/Delete Dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditDialog(script)}>
                        <Pencil className="w-4 h-4 mr-2" />
                        편집
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => {
                          setDeletingScript(script);
                          setShowDeleteDialog(true);
                        }}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        삭제
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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

      {/* Create/Edit Script Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{editingScript ? '스크립트 수정' : '새 스크립트 등록'}</DialogTitle>
            <DialogDescription>
              {editingScript ? '스크립트 정보를 수정합니다.' : '새로운 스크립트를 등록합니다.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor="script-name">이름 *</Label>
              <Input
                id="script-name"
                value={scriptForm.name}
                onChange={(e) => setScriptForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="예: 데이터베이스 백업"
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="script-description">설명</Label>
              <Textarea
                id="script-description"
                value={scriptForm.description}
                onChange={(e) => setScriptForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="스크립트에 대한 설명을 입력하세요"
                rows={2}
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="script-command">명령어 *</Label>
              <Textarea
                id="script-command"
                value={scriptForm.command}
                onChange={(e) => setScriptForm(prev => ({ ...prev, command: e.target.value }))}
                placeholder="예: ./scripts/backup-db.sh"
                rows={3}
                className="font-mono text-sm"
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="script-working-dir">작업 디렉토리</Label>
              <Input
                id="script-working-dir"
                value={scriptForm.working_directory}
                onChange={(e) => setScriptForm(prev => ({ ...prev, working_directory: e.target.value }))}
                placeholder="예: /home/user/project (비워두면 프로젝트 루트)"
                disabled={isSubmitting}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>위험도</Label>
                <Select
                  value={scriptForm.risk_level}
                  onValueChange={(value: 'low' | 'medium' | 'high' | 'critical') => 
                    setScriptForm(prev => ({ ...prev, risk_level: value }))
                  }
                  disabled={isSubmitting}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low - 안전</SelectItem>
                    <SelectItem value="medium">Medium - 주의</SelectItem>
                    <SelectItem value="high">High - 위험</SelectItem>
                    <SelectItem value="critical">Critical - 매우 위험</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="script-duration">예상 소요 시간 (초)</Label>
                <Input
                  id="script-duration"
                  type="number"
                  min={1}
                  value={scriptForm.estimated_duration}
                  onChange={(e) => setScriptForm(prev => ({ ...prev, estimated_duration: parseInt(e.target.value) || 60 }))}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>허용 환경</Label>
              <div className="flex flex-wrap gap-2">
                <Badge 
                  variant={scriptForm.allowed_environments.includes('*') ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => {
                    if (scriptForm.allowed_environments.includes('*')) {
                      setScriptForm(prev => ({ ...prev, allowed_environments: [] }));
                    } else {
                      setScriptForm(prev => ({ ...prev, allowed_environments: ['*'] }));
                    }
                  }}
                >
                  모든 환경
                </Badge>
                {environments.map(env => (
                  <Badge
                    key={env.id}
                    variant={scriptForm.allowed_environments.includes(env.id) ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => {
                      if (scriptForm.allowed_environments.includes('*')) {
                        setScriptForm(prev => ({ ...prev, allowed_environments: [env.id] }));
                      } else if (scriptForm.allowed_environments.includes(env.id)) {
                        setScriptForm(prev => ({ 
                          ...prev, 
                          allowed_environments: prev.allowed_environments.filter(e => e !== env.id)
                        }));
                      } else {
                        setScriptForm(prev => ({ 
                          ...prev, 
                          allowed_environments: [...prev.allowed_environments, env.id]
                        }));
                      }
                    }}
                  >
                    {env.name}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} disabled={isSubmitting}>
              취소
            </Button>
            <Button onClick={handleSaveScript} disabled={isSubmitting}>
              {isSubmitting ? '저장 중...' : (editingScript ? '수정' : '등록')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>스크립트 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              정말로 '{deletingScript?.name}' 스크립트를 삭제하시겠습니까?
              <br />
              이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteScript}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
