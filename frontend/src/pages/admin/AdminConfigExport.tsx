import { useState, useRef, useCallback } from 'react';
import {
  Download,
  Upload,
  FileJson,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Eye,
  Copy,
  ShieldAlert,
  FileUp,
  Bot,
  Cpu,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  exportSystemConfig,
  importSystemConfig,
  validateSystemConfig,
  getConfigTemplate,
} from '@/lib/api';
import type {
  SystemConfigExport,
  SystemConfigImport,
  ConfigImportResult,
} from '@/types/api';

export default function AdminConfigExport() {
  const { toast } = useToast();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportData, setExportData] = useState<SystemConfigExport | null>(null);
  const [includeLlm, setIncludeLlm] = useState(true);
  const [includeMl, setIncludeMl] = useState(true);

  // Import state
  const [isImporting, setIsImporting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importData, setImportData] = useState<SystemConfigImport | null>(null);
  const [importJson, setImportJson] = useState('');
  const [importResult, setImportResult] = useState<ConfigImportResult | null>(null);
  const [importOptions, setImportOptions] = useState({
    overwriteExisting: true,
    skipLlmProviders: false,
    skipMlAddons: false,
  });

  // Preview dialog
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);

  const isAdmin = user?.role === 'admin';

  // Export configuration
  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const data = await exportSystemConfig(includeLlm, includeMl);
      setExportData(data);
      toast({
        title: 'Export 완료',
        description: `LLM: ${data.llmProviders.length}개, ML: ${data.mlAddons.length}개 설정이 준비되었습니다.`,
      });
    } catch (error) {
      console.error('Export failed:', error);
      toast({
        title: 'Export 실패',
        description: '설정을 내보내는데 실패했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  }, [includeLlm, includeMl, toast]);

  // Download as file
  const handleDownload = useCallback(() => {
    if (!exportData) return;

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `newsinsight-config-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: '다운로드 완료',
      description: '설정 파일이 다운로드되었습니다.',
    });
  }, [exportData, toast]);

  // Copy to clipboard
  const handleCopyToClipboard = useCallback(() => {
    if (!exportData) return;

    navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
    toast({
      title: '복사 완료',
      description: '설정이 클립보드에 복사되었습니다.',
    });
  }, [exportData, toast]);

  // File input change
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text) as SystemConfigImport;
        setImportData(parsed);
        setImportJson(text);
        setImportDialogOpen(true);
        setImportResult(null);
      } catch (error) {
        toast({
          title: '파일 파싱 실패',
          description: '유효한 JSON 파일이 아닙니다.',
          variant: 'destructive',
        });
      }
    };
    reader.readAsText(file);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [toast]);

  // Validate import config
  const handleValidate = useCallback(async () => {
    if (!importData) return;

    setIsValidating(true);
    try {
      const result = await validateSystemConfig(importData);
      setImportResult(result);
      toast({
        title: result.success ? '검증 성공' : '검증 실패',
        description: result.message,
        variant: result.success ? 'default' : 'destructive',
      });
    } catch (error) {
      console.error('Validation failed:', error);
      toast({
        title: '검증 실패',
        description: '설정 검증 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsValidating(false);
    }
  }, [importData, toast]);

  // Import configuration
  const handleImport = useCallback(async () => {
    if (!importData) return;

    setIsImporting(true);
    try {
      const result = await importSystemConfig(importData, importOptions);
      setImportResult(result);

      if (result.success) {
        toast({
          title: 'Import 완료',
          description: result.message,
        });
        setImportDialogOpen(false);
      } else {
        toast({
          title: 'Import 부분 실패',
          description: result.message,
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Import failed:', error);
      toast({
        title: 'Import 실패',
        description: '설정을 가져오는데 실패했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsImporting(false);
    }
  }, [importData, importOptions, toast]);

  // Load template
  const handleLoadTemplate = useCallback(async () => {
    try {
      const template = await getConfigTemplate();
      setImportData(template);
      setImportJson(JSON.stringify(template, null, 2));
      setImportDialogOpen(true);
      setImportResult(null);
      toast({
        title: '템플릿 로드',
        description: '예시 템플릿이 로드되었습니다. API Key를 실제 값으로 교체하세요.',
      });
    } catch (error) {
      console.error('Failed to load template:', error);
      toast({
        title: '템플릿 로드 실패',
        description: '템플릿을 불러오는데 실패했습니다.',
        variant: 'destructive',
      });
    }
  }, [toast]);

  // Access denied for non-admins
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <ShieldAlert className="w-16 h-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">접근 권한이 없습니다</h2>
        <p className="text-muted-foreground text-center">
          설정 Export/Import는 관리자만 사용할 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 container mx-auto p-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">설정 Export/Import</h1>
          <p className="text-muted-foreground mt-1">
            LLM Provider, ML Addon 등 시스템 설정을 JSON으로 일괄 관리합니다.
          </p>
        </div>
      </div>

      <Alert>
        <FileJson className="w-4 h-4" />
        <AlertDescription>
          설정을 JSON 파일로 내보내거나 가져와서 백업/복원, 환경 간 설정 이전에 활용하세요.
          <strong className="ml-1">API Key는 마스킹되어 Export됩니다.</strong>
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Export Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="w-5 h-5" />
              설정 Export
            </CardTitle>
            <CardDescription>
              현재 시스템 설정을 JSON으로 내보냅니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-muted-foreground" />
                  <Label>LLM Provider 설정 포함</Label>
                </div>
                <Switch
                  checked={includeLlm}
                  onCheckedChange={setIncludeLlm}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-muted-foreground" />
                  <Label>ML Addon 설정 포함</Label>
                </div>
                <Switch
                  checked={includeMl}
                  onCheckedChange={setIncludeMl}
                />
              </div>
            </div>

            <Separator />

            <div className="flex gap-2">
              <Button
                onClick={handleExport}
                disabled={isExporting || (!includeLlm && !includeMl)}
                className="flex-1"
              >
                {isExporting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                설정 불러오기
              </Button>
            </div>

            {exportData && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span>
                    LLM: {exportData.llmProviders.length}개, ML: {exportData.mlAddons.length}개
                  </span>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPreviewDialogOpen(true)}
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    미리보기
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyToClipboard}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    복사
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleDownload}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    다운로드
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Import Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              설정 Import
            </CardTitle>
            <CardDescription>
              JSON 파일에서 설정을 가져옵니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive" className="bg-yellow-500/10 border-yellow-500/50">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
              <AlertTitle className="text-yellow-600">주의</AlertTitle>
              <AlertDescription className="text-yellow-600">
                Import 시 기존 설정이 덮어쓰여질 수 있습니다.
                <br />
                API Key는 반드시 실제 값으로 교체해야 합니다.
              </AlertDescription>
            </Alert>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileSelect}
              className="hidden"
            />

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1"
              >
                <FileUp className="w-4 h-4 mr-2" />
                파일 선택
              </Button>
              <Button
                variant="secondary"
                onClick={handleLoadTemplate}
              >
                <FileJson className="w-4 h-4 mr-2" />
                템플릿
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Preview Dialog */}
      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Export 미리보기</DialogTitle>
            <DialogDescription>
              내보낼 설정의 JSON 내용입니다.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <pre className="bg-muted p-4 rounded-lg text-xs overflow-auto max-h-[50vh]">
              {exportData ? JSON.stringify(exportData, null, 2) : ''}
            </pre>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewDialogOpen(false)}>
              닫기
            </Button>
            <Button onClick={handleDownload}>
              <Download className="w-4 h-4 mr-2" />
              다운로드
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>설정 Import</DialogTitle>
            <DialogDescription>
              가져올 설정을 확인하고 옵션을 선택하세요.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto space-y-4">
            {/* Import Summary */}
            {importData && (
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Bot className="w-4 h-4" />
                      LLM Provider ({importData.llmProviders.length}개)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="py-2">
                    <div className="space-y-1">
                      {importData.llmProviders.map((p, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span>{p.providerType}</span>
                          <Badge variant={p.apiKey ? 'default' : 'secondary'}>
                            {p.apiKey ? 'API Key 있음' : 'API Key 없음'}
                          </Badge>
                        </div>
                      ))}
                      {importData.llmProviders.length === 0 && (
                        <span className="text-muted-foreground text-sm">없음</span>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Cpu className="w-4 h-4" />
                      ML Addon ({importData.mlAddons.length}개)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="py-2">
                    <div className="space-y-1">
                      {importData.mlAddons.map((a, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span>{a.name}</span>
                          <code className="text-xs bg-muted px-1 rounded">{a.addon_key}</code>
                        </div>
                      ))}
                      {importData.mlAddons.length === 0 && (
                        <span className="text-muted-foreground text-sm">없음</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Import Options */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Import 옵션</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>기존 설정 덮어쓰기</Label>
                  <Switch
                    checked={importOptions.overwriteExisting}
                    onCheckedChange={(v) =>
                      setImportOptions((prev) => ({ ...prev, overwriteExisting: v }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>LLM Provider 건너뛰기</Label>
                  <Switch
                    checked={importOptions.skipLlmProviders}
                    onCheckedChange={(v) =>
                      setImportOptions((prev) => ({ ...prev, skipLlmProviders: v }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>ML Addon 건너뛰기</Label>
                  <Switch
                    checked={importOptions.skipMlAddons}
                    onCheckedChange={(v) =>
                      setImportOptions((prev) => ({ ...prev, skipMlAddons: v }))
                    }
                  />
                </div>
              </CardContent>
            </Card>

            {/* JSON Editor */}
            <Accordion type="single" collapsible>
              <AccordionItem value="json">
                <AccordionTrigger>JSON 편집</AccordionTrigger>
                <AccordionContent>
                  <Textarea
                    value={importJson}
                    onChange={(e) => {
                      setImportJson(e.target.value);
                      try {
                        setImportData(JSON.parse(e.target.value));
                      } catch {
                        // Invalid JSON, ignore
                      }
                    }}
                    className="font-mono text-xs h-64"
                    placeholder="JSON 설정을 붙여넣으세요..."
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {/* Import Result */}
            {importResult && (
              <Alert variant={importResult.success ? 'default' : 'destructive'}>
                {importResult.success ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <XCircle className="w-4 h-4" />
                )}
                <AlertTitle>{importResult.success ? '성공' : '실패'}</AlertTitle>
                <AlertDescription>
                  <p>{importResult.message}</p>
                  <div className="mt-2 text-sm">
                    <p>LLM: {importResult.llmProvidersImported}개 성공, {importResult.llmProvidersFailed}개 실패</p>
                    <p>ML: {importResult.mlAddonsImported}개 성공, {importResult.mlAddonsFailed}개 실패</p>
                  </div>
                  {importResult.warnings.length > 0 && (
                    <div className="mt-2">
                      <p className="font-medium">경고:</p>
                      <ul className="list-disc list-inside text-sm">
                        {importResult.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {importResult.errors.length > 0 && (
                    <div className="mt-2">
                      <p className="font-medium">오류:</p>
                      <ul className="list-disc list-inside text-sm">
                        {importResult.errors.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              취소
            </Button>
            <Button
              variant="secondary"
              onClick={handleValidate}
              disabled={isValidating || !importData}
            >
              {isValidating ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Eye className="w-4 h-4 mr-2" />
              )}
              검증
            </Button>
            <Button
              onClick={handleImport}
              disabled={isImporting || !importData}
            >
              {isImporting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              Import 실행
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
