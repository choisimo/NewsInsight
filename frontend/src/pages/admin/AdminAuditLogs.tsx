import { useEffect, useState } from 'react';
import { auditApi } from '@/lib/adminApi';
import type { AuditLog } from '@/types/admin';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';
import { Input } from "@/components/ui/input";
import { Button } from '@/components/ui/button';
import { Search, Filter, Download } from 'lucide-react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

export default function AdminAuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState({
    userId: '',
    action: '',
    resourceType: '',
    page: 1,
    pageSize: 50
  });

  useEffect(() => {
    loadLogs();
  }, [filters.page]);

  const loadLogs = async () => {
    setIsLoading(true);
    try {
      const data = await auditApi.list(filters);
      setLogs(data);
    } catch (error) {
      console.error('Failed to load audit logs:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = () => {
    setFilters(prev => ({ ...prev, page: 1 }));
    loadLogs();
  };

  const getActionBadge = (action: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      'login': 'secondary',
      'logout': 'outline',
      'create': 'default',
      'update': 'default', // blue-ish usually
      'delete': 'destructive',
      'execute': 'default',
      'deploy': 'default',
      'rollback': 'destructive'
    };
    
    return <Badge variant={variants[action] || 'outline'}>{action}</Badge>;
  };

  return (
    <div className="space-y-6 container mx-auto p-4">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">감사 로그</h1>
        <Button variant="outline">
          <Download className="w-4 h-4 mr-2" />
          CSV 내보내기
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="사용자 ID 검색..." 
                  className="pl-8"
                  value={filters.userId}
                  onChange={(e) => setFilters(prev => ({ ...prev, userId: e.target.value }))}
                />
              </div>
              <div className="relative flex-1">
                <Filter className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="리소스 타입..." 
                  className="pl-8"
                  value={filters.resourceType}
                  onChange={(e) => setFilters(prev => ({ ...prev, resourceType: e.target.value }))}
                />
              </div>
              <Button onClick={handleSearch}>검색</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>시간</TableHead>
                  <TableHead>사용자</TableHead>
                  <TableHead>액션</TableHead>
                  <TableHead>리소스</TableHead>
                  <TableHead>환경</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center h-24">
                      <div className="flex justify-center items-center">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                      </div>
                    </TableCell>
                  </TableRow>
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">
                      로그 데이터가 없습니다.
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs">
                        {format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{log.username}</span>
                          <span className="text-xs text-muted-foreground">{log.user_id}</span>
                        </div>
                      </TableCell>
                      <TableCell>{getActionBadge(log.action)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{log.resource_type}</span>
                          <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                            {log.resource_name || log.resource_id}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{log.environment_name || '-'}</TableCell>
                      <TableCell>
                        <Badge variant={log.success ? 'outline' : 'destructive'} className={log.success ? 'text-green-600 border-green-200 bg-green-50' : ''}>
                          {log.success ? '성공' : '실패'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{log.ip_address}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          
          <div className="flex items-center justify-end space-x-2 py-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilters(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
              disabled={filters.page <= 1 || isLoading}
            >
              이전
            </Button>
            <div className="text-sm font-medium">Page {filters.page}</div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilters(prev => ({ ...prev, page: prev.page + 1 }))}
              disabled={logs.length < filters.pageSize || isLoading}
            >
              다음
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
