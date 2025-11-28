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
import { RefreshCw, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { listSources, createSource, setSourceActive, type CreateDataSourcePayload } from "@/lib/api";
import type { DataSource, SourceType } from "@/types/api";

const DEFAULT_FREQUENCY = 3600;

const AdminSources = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Form states
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("RSS");
  const [collectionFrequency, setCollectionFrequency] = useState<string>(String(DEFAULT_FREQUENCY));
  const [category, setCategory] = useState("");
  const [country, setCountry] = useState("KR");
  const [language, setLanguage] = useState("ko");

  // React Query: 소스 목록 조회
  const {
    data: sourcesPage,
    isLoading,
    error,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['sources'],
    queryFn: () => listSources(0, 100, 'id', 'DESC'),
    staleTime: 30_000, // 30초간 fresh
    gcTime: 5 * 60_000, // 5분간 캐시 유지
    refetchInterval: 60_000, // 1분마다 자동 갱신
    retry: 3,
  });

  const sources = sourcesPage?.content ?? [];

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
      // 낙관적 업데이트
      await queryClient.cancelQueries({ queryKey: ['sources'] });
      
      const previousData = queryClient.getQueryData(['sources']);
      
      queryClient.setQueryData(['sources'], (old: typeof sourcesPage) => {
        if (!old) return old;
        return {
          ...old,
          content: old.content.map((s: DataSource) => 
            s.id === id ? { ...s, isActive: active } : s
          ),
        };
      });
      
      return { previousData };
    },
    onError: (error, variables, context) => {
      // 실패 시 롤백
      if (context?.previousData) {
        queryClient.setQueryData(['sources'], context.previousData);
      }
      toast({
        title: "상태 변경 실패",
        description: "잠시 후 다시 시도해주세요.",
        variant: "destructive",
      });
    },
    onSuccess: (updated) => {
      // 성공 시 서버 데이터로 업데이트
      queryClient.setQueryData(['sources'], (old: typeof sourcesPage) => {
        if (!old) return old;
        return {
          ...old,
          content: old.content.map((s: DataSource) => 
            s.id === updated.id ? updated : s
          ),
        };
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
    };

    createMutation.mutate(payload);
  };

  const handleToggleActive = (source: DataSource, active: boolean) => {
    toggleActiveMutation.mutate({ id: source.id, active });
  };

  return (
    <div className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-6xl space-y-6">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">데이터 소스 관리</h1>
            <p className="text-muted-foreground text-sm">
              RSS / WEB / API / WEBHOOK 소스를 등록하고 활성화 상태를 관리하는 관리자 화면입니다.
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
                        <SelectItem value="API">API</SelectItem>
                        <SelectItem value="WEBHOOK">WEBHOOK</SelectItem>
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
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default AdminSources;
