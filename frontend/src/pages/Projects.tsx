import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  FolderOpen,
  Plus,
  Search,
  MoreVertical,
  Calendar,
  FileText,
  Trash2,
  Edit,
  FolderPlus,
  Star,
  Clock,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// ============================================
// Projects Page Component
// ============================================

// Mock data for demonstration - will be replaced with API calls
const mockProjects = [
  {
    id: '1',
    name: '2024 대선 관련 뉴스',
    description: '2024년 대통령 선거 관련 뉴스 모음',
    createdAt: '2024-01-15',
    updatedAt: '2024-01-20',
    itemCount: 45,
    isFavorite: true,
  },
  {
    id: '2',
    name: '경제 동향 분석',
    description: '국내외 경제 뉴스 및 분석 자료',
    createdAt: '2024-01-10',
    updatedAt: '2024-01-19',
    itemCount: 32,
    isFavorite: false,
  },
  {
    id: '3',
    name: 'AI 기술 트렌드',
    description: 'AI 및 머신러닝 관련 기술 뉴스',
    createdAt: '2024-01-05',
    updatedAt: '2024-01-18',
    itemCount: 28,
    isFavorite: true,
  },
];

const Projects = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = React.useState('');
  const [projects] = React.useState(mockProjects);

  const filteredProjects = projects.filter(project =>
    project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    project.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreateProject = () => {
    // TODO: Implement project creation modal
    alert('프로젝트 생성 기능은 곧 추가될 예정입니다.');
  };

  const handleOpenProject = (projectId: string) => {
    // Navigate to search with project context
    navigate(`/?project=${projectId}`);
  };

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
            검색으로 돌아가기
          </Link>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <FolderOpen className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">프로젝트</h1>
                <p className="text-muted-foreground">
                  검색 결과와 분석 자료를 프로젝트별로 관리합니다.
                </p>
              </div>
            </div>
            <Button onClick={handleCreateProject}>
              <Plus className="h-4 w-4 mr-2" />
              새 프로젝트
            </Button>
          </div>
        </header>

        {/* Search & Filter */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="프로젝트 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                  <FolderPlus className="h-5 w-5 text-blue-600 dark:text-blue-300" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{projects.length}</p>
                  <p className="text-sm text-muted-foreground">전체 프로젝트</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-yellow-100 dark:bg-yellow-900 rounded-lg">
                  <Star className="h-5 w-5 text-yellow-600 dark:text-yellow-300" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{projects.filter(p => p.isFavorite).length}</p>
                  <p className="text-sm text-muted-foreground">즐겨찾기</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
                  <FileText className="h-5 w-5 text-green-600 dark:text-green-300" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{projects.reduce((acc, p) => acc + p.itemCount, 0)}</p>
                  <p className="text-sm text-muted-foreground">총 아이템</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Projects List */}
        {filteredProjects.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FolderOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium mb-2">프로젝트가 없습니다</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {searchQuery ? '검색 조건에 맞는 프로젝트가 없습니다.' : '새 프로젝트를 만들어 검색 결과를 정리해보세요.'}
              </p>
              {!searchQuery && (
                <Button onClick={handleCreateProject}>
                  <Plus className="h-4 w-4 mr-2" />
                  첫 프로젝트 만들기
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {filteredProjects.map((project) => (
              <Card
                key={project.id}
                className="hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => handleOpenProject(project.id)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-muted rounded-lg">
                        <FolderOpen className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          {project.name}
                          {project.isFavorite && (
                            <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />
                          )}
                        </CardTitle>
                        <CardDescription>{project.description}</CardDescription>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="sm">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>
                          <Edit className="h-4 w-4 mr-2" />
                          이름 변경
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <Star className="h-4 w-4 mr-2" />
                          {project.isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive">
                          <Trash2 className="h-4 w-4 mr-2" />
                          삭제
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <FileText className="h-4 w-4" />
                      {project.itemCount}개 항목
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      {project.createdAt}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      {project.updatedAt} 수정됨
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Coming Soon Features */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="text-base">향후 추가될 기능</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Badge variant="outline">예정</Badge>
                <span>검색 결과를 프로젝트에 저장</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">예정</Badge>
                <span>프로젝트별 분석 리포트 생성</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">예정</Badge>
                <span>팀 협업 및 공유 기능</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">예정</Badge>
                <span>프로젝트 내보내기 (PDF, CSV)</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Projects;
