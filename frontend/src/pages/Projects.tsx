import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  FolderOpen,
  Construction,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// ============================================
// Projects Page Component
// 백엔드에 프로젝트 API가 구현되면 연동 예정
// ============================================

const Projects = () => {
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
        </header>

        {/* Coming Soon Notice */}
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <div className="flex justify-center mb-6">
              <div className="p-4 bg-amber-100 dark:bg-amber-900/30 rounded-full">
                <Construction className="h-12 w-12 text-amber-600 dark:text-amber-400" />
              </div>
            </div>
            <h2 className="text-2xl font-bold mb-3">프로젝트 기능 준비 중</h2>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              프로젝트 관리 기능은 현재 개발 중입니다.
              검색 결과와 분석 자료를 체계적으로 정리할 수 있는 기능이 곧 추가됩니다.
            </p>
            <div className="flex flex-wrap justify-center gap-2 mb-8">
              <Badge variant="outline">검색 결과 저장</Badge>
              <Badge variant="outline">분석 리포트 생성</Badge>
              <Badge variant="outline">팀 협업</Badge>
              <Badge variant="outline">PDF/CSV 내보내기</Badge>
            </div>
            <Link to="/search">
              <Button>
                검색으로 이동
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Alternative Actions */}
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">검색 기록</CardTitle>
              <CardDescription>
                지금까지 수행한 검색 내역을 확인하고 다시 검색할 수 있습니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to="/history">
                <Button variant="outline" className="w-full">
                  검색 기록 보기
                </Button>
              </Link>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">URL 컬렉션</CardTitle>
              <CardDescription>
                수집한 URL을 폴더별로 정리하고 관리할 수 있습니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link to="/url-collections">
                <Button variant="outline" className="w-full">
                  URL 컬렉션 보기
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Projects;
