import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { listSources, createSource, setSourceActive, type CreateDataSourcePayload } from "@/lib/api";
import type { DataSource, SourceType } from "@/types/api";

const DEFAULT_FREQUENCY = 3600;

const AdminSources = () => {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("RSS");
  const [collectionFrequency, setCollectionFrequency] = useState<string>(String(DEFAULT_FREQUENCY));
  const [category, setCategory] = useState("");
  const [country, setCountry] = useState("KR");
  const [language, setLanguage] = useState("ko");
  const [saving, setSaving] = useState(false);

  const loadSources = async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await listSources(0, 100, "id", "DESC");
      setSources(page.content);
    } catch (e: any) {
      console.error("Failed to load data sources", e);
      setError(e?.message || "데이터 소스를 불러오는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSources();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) {
      setError("이름과 URL을 모두 입력해 주세요.");
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

    setSaving(true);
    setError(null);
    try {
      const created = await createSource(payload);
      setSources((prev) => [created, ...prev]);

      setName("");
      setUrl("");
      setCollectionFrequency(String(DEFAULT_FREQUENCY));
      // category/country/language는 유지하여 여러 개를 연속으로 넣기 편하게 둠
    } catch (e: any) {
      console.error("Failed to create data source", e);
      setError(e?.response?.data?.message || e?.message || "데이터 소스를 생성하는 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (source: DataSource, active: boolean) => {
    // 낙관적 업데이트
    setSources((prev) => prev.map((s) => (s.id === source.id ? { ...s, isActive: active } : s)));
    try {
      const updated = await setSourceActive(source.id, active);
      setSources((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (e) {
      console.error("Failed to toggle active state", e);
      // 실패 시 롤백
      setSources((prev) => prev.map((s) => (s.id === source.id ? { ...s, isActive: source.isActive } : s)));
    }
  };

  return (
    <div className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-6xl space-y-6">
        <header className="mb-4">
          <h1 className="text-3xl font-bold mb-2">데이터 소스 관리</h1>
          <p className="text-muted-foreground text-sm">
            RSS / WEB / API / WEBHOOK 소스를 등록하고 활성화 상태를 관리하는 관리자 화면입니다.
          </p>
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
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="url">URL</Label>
                  <Input
                    id="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="예: https://www.yna.co.kr/rss/allheadline.xml"
                    disabled={saving}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="sourceType">타입</Label>
                    <Select
                      value={sourceType}
                      onValueChange={(value) => setSourceType(value as SourceType)}
                      disabled={saving}
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
                      disabled={saving}
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
                      disabled={saving}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="country">국가</Label>
                    <Input
                      id="country"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      placeholder="KR"
                      disabled={saving}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="language">언어</Label>
                    <Input
                      id="language"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      placeholder="ko"
                      disabled={saving}
                    />
                  </div>
                </div>
                {error && (
                  <p className="text-sm text-destructive mt-1">{error}</p>
                )}
                <Button type="submit" className="w-full" disabled={saving}>
                  {saving ? "등록 중..." : "소스 등록"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2 shadow-elegant">
            <CardHeader>
              <CardTitle>등록된 소스</CardTitle>
              <CardDescription>최근 등록 순으로 최대 100개까지 표시됩니다.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground">불러오는 중...</p>
              ) : sources.length === 0 ? (
                <p className="text-sm text-muted-foreground">등록된 소스가 없습니다. 왼쪽 폼에서 첫 소스를 등록해 보세요.</p>
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
                          <TableCell>{source.sourceType}</TableCell>
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
