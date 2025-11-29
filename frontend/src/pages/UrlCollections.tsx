import React, { useState, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FolderPlus,
  Plus,
  Download,
  Upload,
  Search,
  Trash2,
  Copy,
  ArrowLeft,
  Play,
  Shield,
  CheckSquare,
  Square,
  RefreshCw,
  FileJson,
  Clipboard,
  AlertCircle,
  Info,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { UrlTree } from '@/components/UrlTree';
import { useUrlCollection, type UrlItem } from '@/hooks/useUrlCollection';

// ============================================
// Add Folder Dialog
// ============================================

interface AddFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (name: string, description?: string) => void;
}

const AddFolderDialog: React.FC<AddFolderDialogProps> = ({ open, onOpenChange, onAdd }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onAdd(name.trim(), description.trim() || undefined);
      setName('');
      setDescription('');
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>새 폴더 추가</DialogTitle>
            <DialogDescription>
              URL을 그룹화할 새 폴더를 만듭니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="folder-name">폴더 이름 *</Label>
              <Input
                id="folder-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 경제 뉴스"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="folder-desc">설명 (선택)</Label>
              <Input
                id="folder-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="폴더에 대한 설명"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              추가
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

// ============================================
// Add URL Dialog
// ============================================

interface AddUrlDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (url: string, name?: string, description?: string, tags?: string[]) => void;
}

const AddUrlDialog: React.FC<AddUrlDialogProps> = ({ open, onOpenChange, onAdd }) => {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkUrls, setBulkUrls] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (bulkMode) {
      // Parse multiple URLs (one per line)
      const urls = bulkUrls
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && (line.startsWith('http://') || line.startsWith('https://')));
      
      if (urls.length > 0) {
        for (const u of urls) {
          onAdd(u);
        }
        setBulkUrls('');
        onOpenChange(false);
      }
    } else {
      if (url.trim()) {
        const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
        onAdd(url.trim(), name.trim() || undefined, description.trim() || undefined, tagList.length > 0 ? tagList : undefined);
        setUrl('');
        setName('');
        setDescription('');
        setTags('');
        onOpenChange(false);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>URL 추가</DialogTitle>
            <DialogDescription>
              분석할 웹 페이지 URL을 추가합니다.
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex gap-2 py-4">
            <Button
              type="button"
              variant={bulkMode ? 'outline' : 'default'}
              size="sm"
              onClick={() => setBulkMode(false)}
            >
              단일 URL
            </Button>
            <Button
              type="button"
              variant={bulkMode ? 'default' : 'outline'}
              size="sm"
              onClick={() => setBulkMode(true)}
            >
              여러 URL 한번에
            </Button>
          </div>

          {bulkMode ? (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>URL 목록 (한 줄에 하나씩)</Label>
                <Textarea
                  value={bulkUrls}
                  onChange={(e) => setBulkUrls(e.target.value)}
                  placeholder={`https://example.com/article1\nhttps://example.com/article2\nhttps://example.com/article3`}
                  className="min-h-[200px] font-mono text-sm"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  {bulkUrls.split('\n').filter(line => line.trim().startsWith('http')).length}개의 유효한 URL
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="url">URL *</Label>
                <Input
                  id="url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/article"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="url-name">이름 (선택)</Label>
                <Input
                  id="url-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="자동으로 도메인에서 추출됩니다"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="url-desc">설명 (선택)</Label>
                <Input
                  id="url-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="이 URL에 대한 메모"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="url-tags">태그 (선택, 쉼표로 구분)</Label>
                <Input
                  id="url-tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="경제, 정치, 국제"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit">
              추가
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

// ============================================
// Import/Export Dialog
// ============================================

interface ImportExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'import' | 'export';
  exportData?: string;
  onImport: (json: string) => boolean;
}

const ImportExportDialog: React.FC<ImportExportDialogProps> = ({
  open,
  onOpenChange,
  mode,
  exportData,
  onImport,
}) => {
  const { toast } = useToast();
  const [jsonInput, setJsonInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleImport = () => {
    setError(null);
    const success = onImport(jsonInput);
    if (success) {
      toast({ title: '가져오기 완료', description: 'URL 컬렉션을 가져왔습니다.' });
      setJsonInput('');
      onOpenChange(false);
    } else {
      setError('유효하지 않은 JSON 형식입니다.');
    }
  };

  const handleCopy = () => {
    if (exportData) {
      navigator.clipboard.writeText(exportData);
      toast({ title: '복사됨', description: 'JSON이 클립보드에 복사되었습니다.' });
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setJsonInput(text);
    } catch (e) {
      toast({ title: '오류', description: '클립보드에서 읽기에 실패했습니다.', variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'export' ? 'JSON 내보내기' : 'JSON 가져오기'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'export'
              ? 'URL 컬렉션을 JSON으로 복사하여 다른 곳에서 공유할 수 있습니다.'
              : 'JSON 형식의 URL 컬렉션을 붙여넣어 가져옵니다.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {mode === 'export' ? (
            <>
              <Textarea
                value={exportData}
                readOnly
                className="min-h-[300px] font-mono text-xs"
              />
              <Button onClick={handleCopy} className="w-full">
                <Copy className="h-4 w-4 mr-2" />
                클립보드에 복사
              </Button>
            </>
          ) : (
            <>
              <div className="flex justify-end">
                <Button type="button" variant="outline" size="sm" onClick={handlePaste}>
                  <Clipboard className="h-4 w-4 mr-2" />
                  붙여넣기
                </Button>
              </div>
              <Textarea
                value={jsonInput}
                onChange={(e) => {
                  setJsonInput(e.target.value);
                  setError(null);
                }}
                placeholder={`다음 형식 중 하나를 붙여넣으세요:

1. URL 배열:
["https://example.com/1", "https://example.com/2"]

2. URL 객체 배열:
{"urls": [{"url": "https://...", "name": "제목"}]}

3. 전체 컬렉션 (내보내기한 JSON)`}
                className="min-h-[300px] font-mono text-xs"
              />
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
          {mode === 'import' && (
            <Button onClick={handleImport} disabled={!jsonInput.trim()}>
              <Upload className="h-4 w-4 mr-2" />
              가져오기
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ============================================
// Main Page Component
// ============================================

const UrlCollections = () => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const {
    collection,
    selectedItems,
    selectedCount,
    addFolder,
    addUrl,
    updateItem,
    deleteItem,
    toggleFolder,
    toggleSelection,
    selectAllInFolder,
    clearSelection,
    getSelectedUrls,
    exportToJson,
    exportSelectedToJson,
    importFromJson,
    resetCollection,
  } = useUrlCollection();

  // Dialog states
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [showAddUrl, setShowAddUrl] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showExportSelected, setShowExportSelected] = useState(false);
  const [addParentId, setAddParentId] = useState('root');

  // Handlers
  const handleAddFolder = useCallback((parentId: string) => {
    setAddParentId(parentId);
    setShowAddFolder(true);
  }, []);

  const handleAddUrl = useCallback((parentId: string) => {
    setAddParentId(parentId);
    setShowAddUrl(true);
  }, []);

  const handleDeleteSelected = useCallback(() => {
    const selectedUrls = getSelectedUrls();
    for (const url of selectedUrls) {
      deleteItem(url.id);
    }
    for (const folderId of selectedItems.folders) {
      deleteItem(folderId);
    }
    toast({
      title: '삭제 완료',
      description: `${selectedCount}개 항목이 삭제되었습니다.`,
    });
  }, [deleteItem, getSelectedUrls, selectedItems.folders, selectedCount, toast]);

  const handleAnalyzeSelected = useCallback((mode: 'search' | 'factcheck') => {
    const selectedUrls = getSelectedUrls();
    if (selectedUrls.length === 0) {
      toast({
        title: '선택된 URL 없음',
        description: '분석할 URL을 선택해주세요.',
        variant: 'destructive',
      });
      return;
    }

    // Store selected URLs in sessionStorage for the analysis page
    sessionStorage.setItem('analysis-urls', JSON.stringify(selectedUrls.map(u => u.url)));
    
    // Navigate to the analysis page
    navigate(mode === 'search' ? '/search' : '/fact-check', {
      state: { priorityUrls: selectedUrls.map(u => u.url) },
    });
  }, [getSelectedUrls, navigate, toast]);

  // Stats
  const stats = useMemo(() => {
    let totalUrls = 0;
    let totalFolders = 0;

    const count = (items: typeof collection.root.children) => {
      for (const item of items) {
        if (item.type === 'url') {
          totalUrls++;
        } else {
          totalFolders++;
          count(item.children);
        }
      }
    };

    count(collection.root.children);
    return { totalUrls, totalFolders };
  }, [collection.root.children]);

  return (
    <div className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-5xl">
        {/* Header */}
        <header className="mb-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            메인으로 돌아가기
          </Link>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold mb-2">
                URL 컬렉션
              </h1>
              <p className="text-muted-foreground">
                분석할 URL을 폴더별로 관리하고 선택하여 우선 분석할 수 있습니다.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline">{stats.totalFolders} 폴더</Badge>
              <Badge variant="outline">{stats.totalUrls} URL</Badge>
            </div>
          </div>
        </header>

        {/* Action Bar */}
        <Card className="mb-6">
          <CardContent className="py-4">
            <div className="flex flex-wrap items-center gap-2">
              {/* Add buttons */}
              <Button variant="outline" size="sm" onClick={() => handleAddFolder('root')}>
                <FolderPlus className="h-4 w-4 mr-2" />
                폴더 추가
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleAddUrl('root')}>
                <Plus className="h-4 w-4 mr-2" />
                URL 추가
              </Button>

              <Separator orientation="vertical" className="h-6" />

              {/* Import/Export */}
              <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
                <Upload className="h-4 w-4 mr-2" />
                가져오기
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowExport(true)}>
                <Download className="h-4 w-4 mr-2" />
                내보내기
              </Button>

              <div className="flex-1" />

              {/* Selection actions */}
              {selectedCount > 0 && (
                <>
                  <Badge variant="secondary" className="mr-2">
                    {selectedCount}개 선택됨
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowExportSelected(true)}
                  >
                    <FileJson className="h-4 w-4 mr-2" />
                    선택 항목 JSON
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className="text-destructive">
                        <Trash2 className="h-4 w-4 mr-2" />
                        삭제
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>선택 항목 삭제</AlertDialogTitle>
                        <AlertDialogDescription>
                          {selectedCount}개의 선택된 항목을 삭제하시겠습니까?
                          이 작업은 취소할 수 없습니다.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>취소</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteSelected}>
                          삭제
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <Button size="sm" variant="outline" onClick={clearSelection}>
                    선택 해제
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Analysis Action */}
        {selectedCount > 0 && (
          <Card className="mb-6 bg-primary/5 border-primary/20">
            <CardContent className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="font-medium">선택된 URL 분석</h3>
                  <p className="text-sm text-muted-foreground">
                    {getSelectedUrls().length}개의 URL을 우선 분석합니다.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => handleAnalyzeSelected('search')}>
                    <Search className="h-4 w-4 mr-2" />
                    통합 검색으로 분석
                  </Button>
                  <Button variant="outline" onClick={() => handleAnalyzeSelected('factcheck')}>
                    <Shield className="h-4 w-4 mr-2" />
                    팩트체크로 분석
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* URL Tree */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle>URL 목록</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => selectAllInFolder('root')}
              >
                <CheckSquare className="h-4 w-4 mr-2" />
                전체 선택
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px] pr-4">
              <UrlTree
                root={collection.root}
                selectedItems={selectedItems}
                onToggleFolder={toggleFolder}
                onToggleSelection={toggleSelection}
                onDelete={deleteItem}
                onUpdate={updateItem}
                onAddFolder={handleAddFolder}
                onAddUrl={handleAddUrl}
                onSelectAll={selectAllInFolder}
              />
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Help Text */}
        <Alert className="mt-6">
          <Info className="h-4 w-4" />
          <AlertDescription>
            <strong>사용법:</strong> 폴더와 URL을 추가하고, 체크박스로 분석할 항목을 선택하세요.
            JSON 내보내기/가져오기로 컬렉션을 공유할 수 있습니다.
            더블클릭으로 이름을 변경할 수 있습니다.
          </AlertDescription>
        </Alert>

        {/* Reset Button */}
        <div className="mt-4 text-center">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                <RefreshCw className="h-4 w-4 mr-2" />
                컬렉션 초기화
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>컬렉션 초기화</AlertDialogTitle>
                <AlertDialogDescription>
                  모든 폴더와 URL을 삭제하고 초기 상태로 되돌립니다.
                  이 작업은 취소할 수 없습니다.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction onClick={resetCollection}>
                  초기화
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Dialogs */}
      <AddFolderDialog
        open={showAddFolder}
        onOpenChange={setShowAddFolder}
        onAdd={(name, desc) => addFolder(addParentId, name, desc)}
      />

      <AddUrlDialog
        open={showAddUrl}
        onOpenChange={setShowAddUrl}
        onAdd={(url, name, desc, tags) => addUrl(addParentId, url, name, desc, tags)}
      />

      <ImportExportDialog
        open={showImport}
        onOpenChange={setShowImport}
        mode="import"
        onImport={importFromJson}
      />

      <ImportExportDialog
        open={showExport}
        onOpenChange={setShowExport}
        mode="export"
        exportData={exportToJson()}
        onImport={() => false}
      />

      <ImportExportDialog
        open={showExportSelected}
        onOpenChange={setShowExportSelected}
        mode="export"
        exportData={exportSelectedToJson()}
        onImport={() => false}
      />
    </div>
  );
};

export default UrlCollections;
