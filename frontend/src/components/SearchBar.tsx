import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";

interface SearchBarProps {
  onSearch: (query: string, window: string) => void;
  isLoading?: boolean;
}

export function SearchBar({ onSearch, isLoading = false }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [window, setWindow] = useState("7d");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query.trim(), window);
    }
  };

  return (
    <Card className="p-6 shadow-elegant card-hover">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <Input
              type="text"
              placeholder="분석하고 싶은 키워드를 입력하세요..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={isLoading}
              className="h-12 text-base"
            />
          </div>
          <div className="w-full sm:w-40">
            <Select value={window} onValueChange={setWindow} disabled={isLoading}>
              <SelectTrigger className="h-12">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card z-50">
                <SelectItem value="1d">최근 1일</SelectItem>
                <SelectItem value="7d">최근 7일</SelectItem>
                <SelectItem value="30d">최근 30일</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            type="submit"
            disabled={isLoading || !query.trim()}
            variant="gradient"
            size="lg"
            className="w-full sm:w-auto"
          >
            {isLoading ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                분석 중...
              </>
            ) : (
              <>
                <Search className="h-5 w-5" />
                분석하기
              </>
            )}
          </Button>
        </div>
      </form>
    </Card>
  );
}
