import { useState, useCallback } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  exportUnifiedSearchReport,
  exportDeepSearchReport,
  triggerPdfDownload,
  type ReportRequest,
  type ReportSection,
  type ReportType,
  DEFAULT_REPORT_SECTIONS,
} from '@/lib/api';
import type { ChartExportHandle } from '@/components/charts';

interface ReportExportButtonProps {
  /** Job ID for the search */
  jobId: string;
  /** Search query */
  query: string;
  /** Time window (1d, 7d, 30d) */
  timeWindow?: string;
  /** Report type */
  reportType?: ReportType;
  /** Chart refs for capturing chart images */
  chartRefs?: Record<string, React.RefObject<ChartExportHandle>>;
  /** Button variant */
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  /** Button size */
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /** Additional CSS classes */
  className?: string;
  /** Disable the button */
  disabled?: boolean;
}

interface SectionOption {
  id: ReportSection;
  label: string;
  description: string;
}

const ALL_SECTIONS: SectionOption[] = [
  { id: 'COVER', label: '표지', description: '보고서 표지 및 기본 정보' },
  { id: 'EXECUTIVE_SUMMARY', label: '요약', description: 'AI 분석 요약 및 핵심 인사이트' },
  { id: 'DATA_SOURCE', label: '데이터 소스', description: '검색 소스별 결과 분포' },
  { id: 'TREND_ANALYSIS', label: '트렌드 분석', description: '시간대별 기사 추이' },
  { id: 'KEYWORD_ANALYSIS', label: '키워드 분석', description: '주요 키워드 및 빈도' },
  { id: 'SENTIMENT_ANALYSIS', label: '감정 분석', description: '긍정/부정/중립 분포' },
  { id: 'RELIABILITY', label: '신뢰도 분석', description: '출처별 신뢰도 평가' },
  { id: 'BIAS_ANALYSIS', label: '편향성 분석', description: '정치적/이념적 편향 분석' },
  { id: 'FACTCHECK', label: '팩트체크', description: '주요 주장 검증 결과' },
  { id: 'EVIDENCE_LIST', label: '증거 목록', description: '수집된 증거 및 출처' },
  { id: 'DETAILED_RESULTS', label: '상세 결과', description: '개별 기사 상세 정보' },
];

/**
 * PDF 보고서 내보내기 버튼 컴포넌트
 * 
 * 차트 이미지를 캡처하고 PDF 보고서를 생성합니다.
 */
export function ReportExportButton({
  jobId,
  query,
  timeWindow = '7d',
  reportType = 'UNIFIED_SEARCH',
  chartRefs,
  variant = 'default',
  size = 'default',
  className,
  disabled = false,
}: ReportExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedSections, setSelectedSections] = useState<ReportSection[]>(
    DEFAULT_REPORT_SECTIONS[reportType]
  );

  const captureChartImages = useCallback((): Record<string, string> => {
    const images: Record<string, string> = {};
    
    if (chartRefs) {
      for (const [key, ref] of Object.entries(chartRefs)) {
        if (ref.current) {
          const base64 = ref.current.toBase64();
          if (base64) {
            images[key] = base64;
          }
        }
      }
    }
    
    return images;
  }, [chartRefs]);

  const handleExport = async () => {
    setIsExporting(true);
    
    try {
      // Capture chart images
      const chartImages = captureChartImages();
      
      const request: ReportRequest = {
        reportType,
        targetId: jobId,
        query,
        timeWindow,
        includeSections: selectedSections,
        chartImages,
        language: 'ko',
      };

      let blob: Blob;
      
      if (reportType === 'DEEP_SEARCH') {
        blob = await exportDeepSearchReport(jobId, request);
      } else {
        blob = await exportUnifiedSearchReport(jobId, request);
      }

      // Generate filename
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const safeQuery = query.replace(/[^가-힣a-zA-Z0-9]/g, '_').slice(0, 30);
      const typeLabel = reportType === 'DEEP_SEARCH' ? 'DeepSearch' : '통합검색';
      const filename = `NewsInsight_${typeLabel}_${safeQuery}_${timestamp}.pdf`;

      // Trigger download
      triggerPdfDownload(blob, filename);
      
      toast.success('PDF 보고서가 다운로드되었습니다.');
      setIsOpen(false);
    } catch (error) {
      console.error('Report export failed:', error);
      toast.error('보고서 생성에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsExporting(false);
    }
  };

  const toggleSection = (sectionId: ReportSection) => {
    setSelectedSections((prev) =>
      prev.includes(sectionId)
        ? prev.filter((s) => s !== sectionId)
        : [...prev, sectionId]
    );
  };

  const selectAll = () => {
    setSelectedSections(ALL_SECTIONS.map((s) => s.id));
  };

  const selectDefault = () => {
    setSelectedSections(DEFAULT_REPORT_SECTIONS[reportType]);
  };

  const availableSections = ALL_SECTIONS.filter((section) => {
    // Filter sections based on report type
    if (reportType === 'UNIFIED_SEARCH') {
      return section.id !== 'EVIDENCE_LIST';
    }
    if (reportType === 'DEEP_SEARCH') {
      return section.id !== 'TREND_ANALYSIS' && section.id !== 'KEYWORD_ANALYSIS';
    }
    return true;
  });

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant={variant}
          size={size}
          className={className}
          disabled={disabled || !jobId}
        >
          <FileText className="h-4 w-4 mr-2" />
          PDF 보고서
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>PDF 보고서 내보내기</DialogTitle>
          <DialogDescription>
            보고서에 포함할 섹션을 선택하세요.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {/* Quick actions */}
          <div className="flex gap-2 mb-4">
            <Button variant="outline" size="sm" onClick={selectAll}>
              전체 선택
            </Button>
            <Button variant="outline" size="sm" onClick={selectDefault}>
              기본값
            </Button>
          </div>

          {/* Section selection */}
          <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
            {availableSections.map((section) => (
              <div
                key={section.id}
                className="flex items-start space-x-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <Checkbox
                  id={section.id}
                  checked={selectedSections.includes(section.id)}
                  onCheckedChange={() => toggleSection(section.id)}
                />
                <div className="flex-1">
                  <Label
                    htmlFor={section.id}
                    className="text-sm font-medium cursor-pointer"
                  >
                    {section.label}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {section.description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="mt-4 pt-4 border-t text-sm text-muted-foreground">
            {selectedSections.length}개 섹션 선택됨
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            취소
          </Button>
          <Button
            onClick={handleExport}
            disabled={isExporting || selectedSections.length === 0}
          >
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                생성 중...
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 mr-2" />
                내보내기
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ReportExportButton;
