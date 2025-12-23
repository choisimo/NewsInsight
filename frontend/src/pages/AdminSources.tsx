import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { RefreshCw, AlertCircle, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { 
  listSources, 
  createSource, 
  updateSource,
  deleteSource,
  setSourceActive, 
  type CreateDataSourcePayload,
  type UpdateDataSourcePayload 
} from "@/lib/api";
import type { DataSource, SourceType } from "@/types/api";

const DEFAULT_FREQUENCY = 3600;

const AdminSources = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Form states for creating new source
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("RSS");
  const [collectionFrequency, setCollectionFrequency] = useState<string>(String(DEFAULT_FREQUENCY));
  const [category, setCategory] = useState("");
  const [country, setCountry] = useState("KR");
  const [language, setLanguage] = useState("ko");
  const [searchUrlTemplate, setSearchUrlTemplate] = useState("");
  const [searchPriority, setSearchPriority] = useState<string>("100");

  // Edit dialog states
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<DataSource | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editSourceType, setEditSourceType] = useState<SourceType>("RSS");
  const [editFrequency, setEditFrequency] = useState<string>(String(DEFAULT_FREQUENCY));
  const [editCategory, setEditCategory] = useState("");
  const [editCountry, setEditCountry] = useState("KR");
  const [editLanguage, setEditLanguage] = useState("ko");
  const [editSearchUrlTemplate, setEditSearchUrlTemplate] = useState("");
  const [editSearchPriority, setEditSearchPriority] = useState<string>("100");

  // Delete dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingSource, setDeletingSource] = useState<DataSource | null>(null);

  // Pagination states
  const [currentPage, setCurrentPage] = useState(0);
  const pageSize = 20;

  // React Query: 소스 목록 조회
  const {
    data: sourcesPage,
    isLoading,
    error,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['sources', currentPage, pageSize],
    queryFn: () => listSources(currentPage, pageSize, 'id', 'DESC'),
    staleTime: 30_000, // 30초간 fresh
    gcTime: 5 * 60_000, // 5분간 캐시 유지
    refetchInterval: 60_000, // 1분마다 자동 갱신
    retry: 3,
  });

  const sources = sourcesPage?.content ?? [];
  const totalPages = sourcesPage?.totalPages ?? 0;
  const totalElements = sourcesPage?.totalElements ?? 0;

  // React Query: 소스 생성 Mutation
  const createMutation = useMutation({
    mutationFn: createSource,
    onSuccess: (created) => {
      // 캐시에 새 소스 추가
      queryClient.setQueryData(['sources'], (old: typeof sourcesPage) => {
        if (!old) return old;
        return {
          ...old,
          content: [created, ...old.content],
          totalElements: old.totalElements + 1,
        };
      });
      
      // 폼 초기화
      setName("");
      setUrl("");
      setCollectionFrequency(String(DEFAULT_FREQUENCY));
      
      toast({
        title: "소스 등록 완료",
        description: `'${created.name}' 소스가 등록되었습니다.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "등록 실패",
        description: error?.response?.data?.message || error?.message || "소스 등록 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // React Query: 소스 활성화/비활성화 Mutation
  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => setSourceActive(id, active),
    onMutate: async ({ id, active }) => {
      // 낙관적 업데이트 - 현재 페이지의 쿼리 키 사용
      const queryKey = ['sources', currentPage, pageSize];
      await queryClient.cancelQueries({ queryKey });
      
      const previousData = queryClient.getQueryData(queryKey);
      
      queryClient.setQueryData(queryKey, (old: typeof sourcesPage) => {
        if (!old) return old;
        return {
          ...old,
          content: old.content.map((s: DataSource) => 
            s.id === id ? { ...s, isActive: active } : s
          ),
        };
      });
      
      return { previousData, queryKey };
    },
    onError: (error, variables, context) => {
      // 실패 시 롤백
      if (context?.previousData && context?.queryKey) {
        queryClient.setQueryData(context.queryKey, context.previousData);
      }
      toast({
        title: "상태 변경 실패",
        description: "잠시 후 다시 시도해주세요.",
        variant: "destructive",
      });
    },
    onSuccess: (updated, variables, context) => {
      // 성공 시 서버 데이터로 업데이트
      if (context?.queryKey) {
        queryClient.setQueryData(context.queryKey, (old: typeof sourcesPage) => {
          if (!old) return old;
          return {
            ...old,
            content: old.content.map((s: DataSource) => 
              s.id === updated.id ? updated : s
            ),
          };
        });
      }
      // 다른 페이지 캐시도 무효화
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
  });

  // React Query: 소스 수정 Mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateDataSourcePayload }) => 
      updateSource(id, payload),
    onSuccess: (updated) => {
      queryClient.setQueryData(['sources'], (old: typeof sourcesPage) => {
        if (!old) return old;
        return {
          ...old,
          content: old.content.map((s: DataSource) => 
            s.id === updated.id ? updated : s
          ),
        };
      });
      
      setEditDialogOpen(false);
      setEditingSource(null);
      
      toast({
        title: "수정 완료",
        description: `'${updated.name}' 소스가 수정되었습니다.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "수정 실패",
        description: error?.response?.data?.message || error?.message || "소스 수정 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // React Query: 소스 삭제 Mutation
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteSource(id),
    onSuccess: (_, deletedId) => {
      queryClient.setQueryData(['sources'], (old: typeof sourcesPage) => {
        if (!old) return old;
        return {
          ...old,
          content: old.content.filter((s: DataSource) => s.id !== deletedId),
          totalElements: old.totalElements - 1,
        };
      });
      
      setDeleteDialogOpen(false);
      setDeletingSource(null);
      
      toast({
        title: "삭제 완료",
        description: "소스가 삭제되었습니다.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "삭제 실패",
        description: error?.response?.data?.message || error?.message || "소스 삭제 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) {
      toast({
        title: "입력 오류",
        description: "이름과 URL을 모두 입력해주세요.",
        variant: "destructive",
      });
      return;
    }

    const freq = Number.parseInt(collectionFrequency, 10);
    const safeFreq = Number.isFinite(freq) && freq >= 60 ? freq : DEFAULT_FREQUENCY;

    const metadata: Record<string, unknown> = {};
    if (category.trim()) metadata.category = category.trim();
    if (country.trim()) metadata.country = country.trim();
    if (language.trim()) metadata.language = language.trim();

    const payload: CreateDataSourcePayload = {
      name: name.trim(),
      url: url.trim(),
      sourceType,
      collectionFrequency: safeFreq,
      metadata,
      searchUrlTemplate: searchUrlTemplate.trim() || undefined,
      searchPriority: searchPriority ? Number.parseInt(searchPriority, 10) : undefined,
    };

    createMutation.mutate(payload);
  };

  const handleToggleActive = (source: DataSource, active: boolean) => {
    toggleActiveMutation.mutate({ id: source.id, active });
  };

  // 편집 다이얼로그 열기
  const handleOpenEdit = (source: DataSource) => {
    setEditingSource(source);
    setEditName(source.name);
    setEditUrl(source.url);
    setEditSourceType(source.sourceType);
    setEditFrequency(String(source.collectionFrequency || DEFAULT_FREQUENCY));
    setEditCategory((source.metadata?.category as string) || "");
    setEditCountry((source.metadata?.country as string) || "KR");
    setEditLanguage((source.metadata?.language as string) || "ko");
    setEditSearchUrlTemplate(source.searchUrlTemplate || "");
    setEditSearchPriority(String(source.searchPriority || 100));
    setEditDialogOpen(true);
  };

  // 편집 저장
  const handleSaveEdit = () => {
    if (!editingSource || !editName.trim() || !editUrl.trim()) {
      toast({
        title: "입력 오류",
        description: "이름과 URL을 모두 입력해주세요.",
        variant: "destructive",
      });
      return;
    }

    const freq = Number.parseInt(editFrequency, 10);
    const safeFreq = Number.isFinite(freq) && freq >= 60 ? freq : DEFAULT_FREQUENCY;

    const metadata: Record<string, unknown> = {};
    if (editCategory.trim()) metadata.category = editCategory.trim();
    if (editCountry.trim()) metadata.country = editCountry.trim();
    if (editLanguage.trim()) metadata.language = editLanguage.trim();

    const payload: UpdateDataSourcePayload = {
      name: editName.trim(),
      url: editUrl.trim(),
      sourceType: editSourceType,
      collectionFrequency: safeFreq,
      metadata,
      searchUrlTemplate: editSearchUrlTemplate.trim() || undefined,
      searchPriority: editSearchPriority ? Number.parseInt(editSearchPriority, 10) : undefined,
    };

    updateMutation.mutate({ id: editingSource.id, payload });
  };

  // 삭제 다이얼로그 열기
  const handleOpenDelete = (source: DataSource) => {
    setDeletingSource(source);
    setDeleteDialogOpen(true);
  };

  // 삭제 확인
  const handleConfirmDelete = () => {
    if (deletingSource) {
      deleteMutation.mutate(deletingSource.id);
    }
  };

  return (
    <div className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-6xl space-y-6">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">데이터 소스 관리</h1>
            <p className="text-muted-foreground text-sm">
              RSS / WEB / API / WEBHOOK / AI Agent 소스를 등록하고 활성화 상태를 관리하는 관리자 화면입니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isFetching && !isLoading && (
              <Badge variant="secondary" className="animate-pulse">
                <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                동기화 중
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
              새로고침
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <Card className="lg:col-span-1 shadow-elegant">
            <CardHeader>
              <CardTitle>새 소스 등록</CardTitle>
              <CardDescription>이름과 URL만 입력하면 나머지는 기본값으로 등록됩니다.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">이름</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="예: 연합뉴스 - 전체"
                    disabled={createMutation.isPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="url">URL</Label>
                  <Input
                    id="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="예: https://www.yna.co.kr/rss/allheadline.xml"
                    disabled={createMutation.isPending}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="sourceType">타입</Label>
                    <Select
                      value={sourceType}
                      onValueChange={(value) => setSourceType(value as SourceType)}
                      disabled={createMutation.isPending}
                    >
                      <SelectTrigger id="sourceType">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="RSS">RSS</SelectItem>
                        <SelectItem value="WEB">WEB</SelectItem>
                        <SelectItem value="WEB_SEARCH">웹 검색</SelectItem>
                        <SelectItem value="API">API</SelectItem>
                        <SelectItem value="WEBHOOK">WEBHOOK</SelectItem>
                        <SelectItem value="BROWSER_AGENT">AI Agent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="frequency">수집 주기(초)</Label>
                    <Input
                      id="frequency"
                      type="number"
                      min={60}
                      value={collectionFrequency}
                      onChange={(e) => setCollectionFrequency(e.target.value)}
                      disabled={createMutation.isPending}
                    />
                  </div>
                </div>
                {sourceType === "WEB_SEARCH" && (
                  <div className="space-y-3 p-3 border rounded-md bg-muted/30">
                    <p className="text-sm font-medium">웹 검색 소스 설정</p>
                    <div className="space-y-2">
                      <Label htmlFor="searchUrlTemplate">검색 URL 템플릿 *</Label>
                      <Input
                        id="searchUrlTemplate"
                        value={searchUrlTemplate}
                        onChange={(e) => setSearchUrlTemplate(e.target.value)}
                        placeholder="예: https://search.naver.com/search.naver?where=news&query={query}"
                        disabled={createMutation.isPending}
                      />
                      <p className="text-xs text-muted-foreground">
                        {"{query}"}를 검색어 위치에 사용하세요. 검색어는 자동으로 URL 인코딩됩니다.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="searchPriority">우선순위 (낮을수록 높음)</Label>
                      <Input
                        id="searchPriority"
                        type="number"
                        min={1}
                        value={searchPriority}
                        onChange={(e) => setSearchPriority(e.target.value)}
                        placeholder="100"
                        disabled={createMutation.isPending}
                      />
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="category">카테고리</Label>
                    <Input
                      id="category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      placeholder="예: 종합, 경제, IT"
                      disabled={createMutation.isPending}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="country">국가</Label>
                    <Input
                      id="country"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      placeholder="KR"
                      disabled={createMutation.isPending}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="language">언어</Label>
                    <Input
                      id="language"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      placeholder="ko"
                      disabled={createMutation.isPending}
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "등록 중..." : "소스 등록"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 shadow-elegant">
            <CardHeader>
              <CardTitle>등록된 소스</CardTitle>
              <CardDescription>
                최근 등록 순으로 최대 100개까지 표시됩니다.
                {sourcesPage && (
                  <span className="ml-2 text-xs">
                    (총 {sourcesPage.totalElements}개)
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="flex items-center gap-4">
                      <Skeleton className="h-4 w-12" />
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-4 flex-1" />
                      <Skeleton className="h-6 w-10" />
                    </div>
                  ))}
                </div>
              ) : error ? (
                <div className="text-center py-8">
                  <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
                  <p className="text-sm text-destructive mb-4">
                    {(error as Error).message || "데이터를 불러오는 중 오류가 발생했습니다."}
                  </p>
                  <Button variant="outline" onClick={() => refetch()}>
                    다시 시도
                  </Button>
                </div>
              ) : sources.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  등록된 소스가 없습니다. 왼쪽 폼에서 첫 소스를 등록해 보세요.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[60px]">ID</TableHead>
                        <TableHead>이름</TableHead>
                        <TableHead>타입</TableHead>
                        <TableHead>URL</TableHead>
                        <TableHead className="w-[80px] text-center">활성</TableHead>
                        <TableHead className="w-[60px] text-center">작업</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sources.map((source) => (
                        <TableRow key={source.id}>
                          <TableCell>{source.id}</TableCell>
                          <TableCell className="font-medium">{source.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{source.sourceType}</Badge>
                          </TableCell>
                          <TableCell className="max-w-xs truncate">
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-500 hover:underline"
                            >
                              {source.url}
                            </a>
                          </TableCell>
                          <TableCell className="text-center">
                            <Switch
                              checked={source.isActive}
                              onCheckedChange={(checked) => handleToggleActive(source, checked)}
                              disabled={toggleActiveMutation.isPending}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleOpenEdit(source)}>
                                  <Pencil className="mr-2 h-4 w-4" />
                                  편집
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  onClick={() => handleOpenDelete(source)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  삭제
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4">
                  <div className="text-sm text-muted-foreground">
                    총 {totalElements}개 중 {currentPage * pageSize + 1}-{Math.min((currentPage + 1) * pageSize, totalElements)}개 표시
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(0)}
                      disabled={currentPage === 0 || isFetching}
                    >
                      처음
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                      disabled={currentPage === 0 || isFetching}
                    >
                      이전
                    </Button>
                    <span className="text-sm px-2">
                      {currentPage + 1} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={currentPage >= totalPages - 1 || isFetching}
                    >
                      다음
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(totalPages - 1)}
                      disabled={currentPage >= totalPages - 1 || isFetching}
                    >
                      마지막
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 편집 다이얼로그 */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>소스 편집</DialogTitle>
              <DialogDescription>
                소스 정보를 수정합니다. 변경사항은 즉시 적용됩니다.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">이름</Label>
                <Input
                  id="edit-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="예: 연합뉴스 - 전체"
                  disabled={updateMutation.isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-url">URL</Label>
                <Input
                  id="edit-url"
                  value={editUrl}
                  onChange={(e) => setEditUrl(e.target.value)}
                  placeholder="예: https://www.yna.co.kr/rss/allheadline.xml"
                  disabled={updateMutation.isPending}
                />
              </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="edit-sourceType">타입</Label>
                    <Select
                      value={editSourceType}
                      onValueChange={(value) => setEditSourceType(value as SourceType)}
                      disabled={updateMutation.isPending}
                    >
                      <SelectTrigger id="edit-sourceType">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="RSS">RSS</SelectItem>
                        <SelectItem value="WEB">WEB</SelectItem>
                        <SelectItem value="WEB_SEARCH">웹 검색</SelectItem>
                        <SelectItem value="API">API</SelectItem>
                        <SelectItem value="WEBHOOK">WEBHOOK</SelectItem>
                        <SelectItem value="BROWSER_AGENT">AI Agent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-frequency">수집 주기(초)</Label>
                    <Input
                      id="edit-frequency"
                      type="number"
                      min={60}
                      value={editFrequency}
                      onChange={(e) => setEditFrequency(e.target.value)}
                      disabled={updateMutation.isPending}
                    />
                  </div>
                </div>
                {editSourceType === "WEB_SEARCH" && (
                  <div className="space-y-3 p-3 border rounded-md bg-muted/30">
                    <p className="text-sm font-medium">웹 검색 소스 설정</p>
                    <div className="space-y-2">
                      <Label htmlFor="edit-searchUrlTemplate">검색 URL 템플릿 *</Label>
                      <Input
                        id="edit-searchUrlTemplate"
                        value={editSearchUrlTemplate}
                        onChange={(e) => setEditSearchUrlTemplate(e.target.value)}
                        placeholder="예: https://search.naver.com/search.naver?where=news&query={query}"
                        disabled={updateMutation.isPending}
                      />
                      <p className="text-xs text-muted-foreground">
                        {"{query}"}를 검색어 위치에 사용하세요. 검색어는 자동으로 URL 인코딩됩니다.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-searchPriority">우선순위 (낮을수록 높음)</Label>
                      <Input
                        id="edit-searchPriority"
                        type="number"
                        min={1}
                        value={editSearchPriority}
                        onChange={(e) => setEditSearchPriority(e.target.value)}
                        placeholder="100"
                        disabled={updateMutation.isPending}
                      />
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="edit-category">카테고리</Label>
                  <Input
                    id="edit-category"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    placeholder="예: 종합, 경제"
                    disabled={updateMutation.isPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-country">국가</Label>
                  <Input
                    id="edit-country"
                    value={editCountry}
                    onChange={(e) => setEditCountry(e.target.value)}
                    placeholder="KR"
                    disabled={updateMutation.isPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-language">언어</Label>
                  <Input
                    id="edit-language"
                    value={editLanguage}
                    onChange={(e) => setEditLanguage(e.target.value)}
                    placeholder="ko"
                    disabled={updateMutation.isPending}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setEditDialogOpen(false)}
                disabled={updateMutation.isPending}
              >
                취소
              </Button>
              <Button onClick={handleSaveEdit} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "저장 중..." : "저장"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 삭제 확인 다이얼로그 */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>소스 삭제</AlertDialogTitle>
              <AlertDialogDescription>
                정말로 '{deletingSource?.name}' 소스를 삭제하시겠습니까?
                <br />
                이 작업은 되돌릴 수 없으며, 관련된 수집 데이터에 영향을 줄 수 있습니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteMutation.isPending}>
                취소
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDelete}
                disabled={deleteMutation.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteMutation.isPending ? "삭제 중..." : "삭제"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};

export default AdminSources;
