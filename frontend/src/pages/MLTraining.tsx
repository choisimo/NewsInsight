import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Brain,
  Play,
  Pause,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Database,
  Upload,
  Download,
  Zap,
  Settings,
  TrendingUp,
  Clock,
  BarChart3,
  Cpu,
  HardDrive,
  Layers,
  FileText,
  ExternalLink,
  Trash2,
  ChevronDown,
  ChevronUp,
  PlayCircle,
  StopCircle,
  Activity,
  Radio,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import {
  checkMLTrainerHealth,
  startTraining,
  getTrainingJobStatus,
  cancelTrainingJob,
  listTrainingJobs,
  listTrainedModels,
  downloadModelArtifact,
  connectTrainingStream,
  startTrainingWithHuggingFaceDataset,
  runInference,
  KOREAN_DATASETS,
  DEFAULT_BASE_MODELS,
  type MLTrainerHealth,
  type TrainingJobStatus,
  type TrainingRequest,
  type ModelArtifact,
  type MLModelType,
  type TrainingJobState,
  type InferenceResponse,
} from '@/lib/api';

// =============================================================================
// Types & Constants
// =============================================================================

interface SSEMetrics {
  loss?: number;
  accuracy?: number;
  validation_loss?: number;
  f1_score?: number;
  learning_rate?: number;
  [key: string]: number | undefined;
}

interface SSEEvent {
  type: string;
  job_id: string;
  progress: number;
  state: TrainingJobState;
  metrics: SSEMetrics;
  current_epoch?: number;
  total_epochs?: number;
  step?: number;
  total_steps?: number;
  [key: string]: unknown;
}

const MODEL_TYPE_LABELS: Record<MLModelType, string> = {
  sentiment: '감정 분석',
  absa: 'ABSA (관점 기반 감정)',
  ner: '개체명 인식',
  classification: '텍스트 분류',
  embedding: '임베딩 모델',
  transformer: '트랜스포머',
};

const JOB_STATE_CONFIG: Record<TrainingJobState, { label: string; color: string; icon: React.ElementType }> = {
  PENDING: { label: '대기 중', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
  INITIALIZING: { label: '초기화 중', color: 'bg-blue-100 text-blue-700', icon: Loader2 },
  RUNNING: { label: '학습 중', color: 'bg-green-100 text-green-700', icon: PlayCircle },
  COMPLETED: { label: '완료', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  FAILED: { label: '실패', color: 'bg-red-100 text-red-700', icon: XCircle },
  CANCELLED: { label: '취소됨', color: 'bg-gray-100 text-gray-700', icon: StopCircle },
};

// =============================================================================
// Helper Components
// =============================================================================

interface MetricCardProps {
  label: string;
  value: string | number;
  icon: React.ElementType;
  trend?: 'up' | 'down' | 'neutral';
}

const MetricCard = ({ label, value, icon: Icon, trend }: MetricCardProps) => (
  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
    <div className="p-2 rounded-md bg-primary/10">
      <Icon className="h-4 w-4 text-primary" />
    </div>
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
    {trend && (
      <TrendingUp
        className={`h-4 w-4 ml-auto ${
          trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500 rotate-180' : 'text-gray-400'
        }`}
      />
    )}
  </div>
);

// =============================================================================
// Training Job Card
// =============================================================================

interface TrainingJobCardProps {
  job: TrainingJobStatus;
  onCancel: (jobId: string) => void;
  onInference: (jobId: string) => void;
  onDownload: (jobId: string) => void;
  isLive?: boolean;
}

const TrainingJobCard = ({ job, onCancel, onInference, onDownload, isLive }: TrainingJobCardProps) => {
  const stateConfig = JOB_STATE_CONFIG[job.state];
  const StateIcon = stateConfig.icon;
  const isRunning = job.state === 'RUNNING' || job.state === 'INITIALIZING';
  const isCompleted = job.state === 'COMPLETED';

  return (
    <Card className={isRunning ? 'border-primary/50 shadow-md' : ''}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              {job.model_name}
              <Badge className={stateConfig.color}>
                <StateIcon className={`h-3 w-3 mr-1 ${isRunning ? 'animate-spin' : ''}`} />
                {stateConfig.label}
              </Badge>
              {isLive && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>실시간 업데이트 연결됨</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </CardTitle>
            <CardDescription className="flex items-center gap-2 mt-1">
              <Badge variant="outline">{MODEL_TYPE_LABELS[job.model_type as MLModelType] || job.model_type}</Badge>
              <span className="text-xs">Job ID: {job.job_id.slice(0, 8)}...</span>
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {isRunning && (
              <Button variant="destructive" size="sm" onClick={() => onCancel(job.job_id)}>
                <Pause className="h-4 w-4 mr-1" />
                취소
              </Button>
            )}
            {isCompleted && (
              <>
                <Button variant="outline" size="sm" onClick={() => onInference(job.job_id)}>
                  <Zap className="h-4 w-4 mr-1" />
                  테스트
                </Button>
                <Button variant="outline" size="sm" onClick={() => onDownload(job.job_id)}>
                  <Download className="h-4 w-4 mr-1" />
                  다운로드
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Progress */}
        <div className="space-y-2 mb-4">
          <div className="flex justify-between text-sm">
            <span>진행률</span>
            <span>{job.progress.toFixed(1)}%</span>
          </div>
          <Progress value={job.progress} className="h-2" />
          {job.current_epoch > 0 && (
            <p className="text-xs text-muted-foreground">
              Epoch {job.current_epoch} / {job.total_epochs}
            </p>
          )}
        </div>

        {/* Metrics */}
        {job.metrics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <div className="p-2 rounded bg-muted/50">
              <p className="text-xs text-muted-foreground">Loss</p>
              <p className="font-mono">{job.metrics.loss?.toFixed(4) || '-'}</p>
            </div>
            <div className="p-2 rounded bg-muted/50">
              <p className="text-xs text-muted-foreground">Accuracy</p>
              <p className="font-mono">{job.metrics.accuracy ? `${(job.metrics.accuracy * 100).toFixed(2)}%` : '-'}</p>
            </div>
            <div className="p-2 rounded bg-muted/50">
              <p className="text-xs text-muted-foreground">Val Loss</p>
              <p className="font-mono">{job.metrics.validation_loss?.toFixed(4) || '-'}</p>
            </div>
            <div className="p-2 rounded bg-muted/50">
              <p className="text-xs text-muted-foreground">F1 Score</p>
              <p className="font-mono">{job.metrics.f1_score ? job.metrics.f1_score.toFixed(4) : '-'}</p>
            </div>
          </div>
        )}

        {/* Error Message */}
        {job.error_message && (
          <Alert variant="destructive" className="mt-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{job.error_message}</AlertDescription>
          </Alert>
        )}

        {/* Timestamps */}
        <div className="flex gap-4 mt-4 text-xs text-muted-foreground">
          <span>생성: {new Date(job.created_at).toLocaleString('ko-KR')}</span>
          {job.started_at && <span>시작: {new Date(job.started_at).toLocaleString('ko-KR')}</span>}
          {job.completed_at && <span>완료: {new Date(job.completed_at).toLocaleString('ko-KR')}</span>}
        </div>
      </CardContent>
    </Card>
  );
};

// =============================================================================
// Dataset Card
// =============================================================================

interface DatasetCardProps {
  dataset: typeof KOREAN_DATASETS[number];
  onSelect: (datasetId: string) => void;
  isSelected: boolean;
}

const DatasetCard = ({ dataset, onSelect, isSelected }: DatasetCardProps) => (
  <Card
    className={`cursor-pointer transition-all hover:shadow-md ${isSelected ? 'border-primary ring-2 ring-primary/20' : ''}`}
    onClick={() => onSelect(dataset.id)}
  >
    <CardContent className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <h4 className="font-semibold">{dataset.name}</h4>
          <p className="text-xs text-muted-foreground mt-1">{dataset.description}</p>
        </div>
        {isSelected && <CheckCircle2 className="h-5 w-5 text-primary" />}
      </div>
      <div className="flex gap-2 mt-3">
        <Badge variant="outline">{dataset.size}</Badge>
        <Badge variant="secondary">{dataset.task}</Badge>
      </div>
    </CardContent>
  </Card>
);

// =============================================================================
// New Training Dialog
// =============================================================================

interface NewTrainingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (request: TrainingRequest) => Promise<void>;
  isSubmitting: boolean;
}

const NewTrainingDialog = ({ open, onOpenChange, onSubmit, isSubmitting }: NewTrainingDialogProps) => {
  const [modelName, setModelName] = useState('');
  const [modelType, setModelType] = useState<MLModelType>('sentiment');
  const [selectedDataset, setSelectedDataset] = useState<string>('');
  const [baseModel, setBaseModel] = useState<string>('');
  const [maxEpochs, setMaxEpochs] = useState(3);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [learningRate, setLearningRate] = useState(2e-5);
  const [batchSize, setBatchSize] = useState(16);

  const filteredDatasets = useMemo(() => {
    return KOREAN_DATASETS.filter(
      (d) => d.task === modelType || d.task === 'classification' || modelType === 'classification'
    );
  }, [modelType]);

  const handleSubmit = async () => {
    if (!modelName || !selectedDataset) return;

    const request: TrainingRequest = {
      model_name: modelName,
      model_type: modelType,
      dataset_path: `huggingface:${selectedDataset}`,
      dataset_format: 'huggingface',
      base_model: baseModel || DEFAULT_BASE_MODELS[modelType][0],
      max_epochs: maxEpochs,
      validation_split: 0.1,
      hyperparameters: {
        learning_rate: learningRate,
        batch_size: batchSize,
        warmup_steps: 500,
        weight_decay: 0.01,
      },
      callbacks: {
        early_stopping: true,
        early_stopping_patience: 3,
        save_best_model: true,
      },
    };

    await onSubmit(request);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            새 ML 모델 학습
          </DialogTitle>
          <DialogDescription>
            HuggingFace 데이터셋을 사용하여 ML 모델을 학습합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Model Name */}
          <div className="space-y-2">
            <Label htmlFor="model-name">모델 이름 *</Label>
            <Input
              id="model-name"
              placeholder="예: my-sentiment-model-v1"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
            />
          </div>

          {/* Model Type */}
          <div className="space-y-2">
            <Label>모델 타입 *</Label>
            <Select value={modelType} onValueChange={(v) => setModelType(v as MLModelType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MODEL_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Dataset Selection */}
          <div className="space-y-2">
            <Label>데이터셋 선택 *</Label>
            <ScrollArea className="h-48 rounded-md border p-2">
              <div className="grid gap-2">
                {filteredDatasets.map((dataset) => (
                  <DatasetCard
                    key={dataset.id}
                    dataset={dataset}
                    isSelected={selectedDataset === dataset.id}
                    onSelect={setSelectedDataset}
                  />
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Base Model */}
          <div className="space-y-2">
            <Label>베이스 모델</Label>
            <Select value={baseModel} onValueChange={setBaseModel}>
              <SelectTrigger>
                <SelectValue placeholder="기본값 사용" />
              </SelectTrigger>
              <SelectContent>
                {DEFAULT_BASE_MODELS[modelType].map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Epochs */}
          <div className="space-y-2">
            <Label>최대 Epochs</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={maxEpochs}
              onChange={(e) => setMaxEpochs(parseInt(e.target.value) || 3)}
            />
          </div>

          {/* Advanced Settings */}
          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between">
                고급 설정
                {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Learning Rate</Label>
                  <Input
                    type="number"
                    step="0.00001"
                    value={learningRate}
                    onChange={(e) => setLearningRate(parseFloat(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Batch Size</Label>
                  <Input
                    type="number"
                    min={1}
                    max={128}
                    value={batchSize}
                    onChange={(e) => setBatchSize(parseInt(e.target.value))}
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={!modelName || !selectedDataset || isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                시작 중...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                학습 시작
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// =============================================================================
// Inference Test Dialog
// =============================================================================

interface InferenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string | null;
  modelName: string;
}

const InferenceDialog = ({ open, onOpenChange, jobId, modelName }: InferenceDialogProps) => {
  const [inputText, setInputText] = useState('');
  const [result, setResult] = useState<InferenceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInference = async () => {
    if (!jobId || !inputText.trim()) return;
    
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await runInference(jobId, {
        text: inputText,
        return_probabilities: true,
      });
      setResult(response);
    } catch (e) {
      setError(e instanceof Error ? e.message : '추론 실패');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            모델 테스트
          </DialogTitle>
          <DialogDescription>
            {modelName} 모델로 텍스트를 분석합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>입력 텍스트</Label>
            <textarea
              className="w-full min-h-24 p-3 rounded-md border bg-background resize-none"
              placeholder="분석할 텍스트를 입력하세요..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
            />
          </div>

          <Button onClick={handleInference} disabled={!inputText.trim() || isLoading} className="w-full">
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                분석 중...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" />
                분석 실행
              </>
            )}
          </Button>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {result && (
            <div className="space-y-3 p-4 rounded-lg bg-muted">
              <div className="flex justify-between items-center">
                <span className="font-medium">예측 결과</span>
                <Badge variant="default" className="text-lg px-3">
                  {result.predicted_label_name || result.predicted_label}
                </Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">신뢰도</span>
                <span className="font-mono">{(result.confidence * 100).toFixed(2)}%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">추론 시간</span>
                <span className="font-mono">{result.inference_time_ms.toFixed(2)}ms</span>
              </div>
              {result.probabilities && (
                <div className="pt-2 border-t">
                  <p className="text-sm text-muted-foreground mb-2">확률 분포</p>
                  {Object.entries(result.probabilities).map(([label, prob]) => (
                    <div key={label} className="flex items-center gap-2 text-sm">
                      <span className="w-20 truncate">{label}</span>
                      <Progress value={prob * 100} className="flex-1 h-2" />
                      <span className="w-16 text-right font-mono">{(prob * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// =============================================================================
// Main Component
// =============================================================================

const MLTraining = () => {
  const { toast } = useToast();
  const [health, setHealth] = useState<MLTrainerHealth | null>(null);
  const [jobs, setJobs] = useState<TrainingJobStatus[]>([]);
  const [models, setModels] = useState<ModelArtifact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isNewTrainingOpen, setIsNewTrainingOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inferenceJob, setInferenceJob] = useState<{ jobId: string; modelName: string } | null>(null);
  const [activeTab, setActiveTab] = useState('jobs');
  const [liveUpdates, setLiveUpdates] = useState<Record<string, SSEEvent>>({});
  const [sseConnected, setSseConnected] = useState<Record<string, boolean>>({});
  
  // SSE event sources ref
  const eventSourcesRef = useRef<Record<string, EventSource>>({});

  // Connect to SSE stream for a specific job
  const connectToJobStream = useCallback((jobId: string) => {
    // Don't connect if already connected
    if (eventSourcesRef.current[jobId]) return;
    
    try {
      const eventSource = connectTrainingStream(
        jobId,
        (event) => {
          // Update live metrics
          setLiveUpdates(prev => ({
            ...prev,
            [jobId]: event,
          }));
          
          // Update job status if state changed
          if (event.state === 'COMPLETED' || event.state === 'FAILED' || event.state === 'CANCELLED') {
            // Disconnect and refresh data
            disconnectFromJobStream(jobId);
            fetchData();
          }
        },
        (error) => {
          console.error(`SSE error for job ${jobId}:`, error);
          setSseConnected(prev => ({ ...prev, [jobId]: false }));
          // Try to reconnect after 5 seconds
          setTimeout(() => {
            if (jobs.some(j => j.job_id === jobId && (j.state === 'RUNNING' || j.state === 'INITIALIZING'))) {
              connectToJobStream(jobId);
            }
          }, 5000);
        }
      );
      
      eventSourcesRef.current[jobId] = eventSource;
      setSseConnected(prev => ({ ...prev, [jobId]: true }));
    } catch (e) {
      console.error(`Failed to connect SSE for job ${jobId}:`, e);
    }
  }, [jobs]);

  // Disconnect from SSE stream
  const disconnectFromJobStream = useCallback((jobId: string) => {
    const eventSource = eventSourcesRef.current[jobId];
    if (eventSource) {
      eventSource.close();
      delete eventSourcesRef.current[jobId];
      setSseConnected(prev => {
        const updated = { ...prev };
        delete updated[jobId];
        return updated;
      });
    }
  }, []);

  // Fetch health, jobs, and models
  const fetchData = useCallback(async () => {
    try {
      const [healthData, jobsData, modelsData] = await Promise.all([
        checkMLTrainerHealth().catch(() => null),
        listTrainingJobs().catch(() => []),
        listTrainedModels().catch(() => []),
      ]);
      setHealth(healthData);
      setJobs(jobsData);
      setModels(modelsData);
    } catch (e) {
      console.error('Failed to fetch ML trainer data:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch and polling
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000); // Refresh every 15s (reduced since we have SSE)
    return () => clearInterval(interval);
  }, [fetchData]);

  // Connect SSE for running jobs
  useEffect(() => {
    const runningJobs = jobs.filter(j => j.state === 'RUNNING' || j.state === 'INITIALIZING');
    
    // Connect to running jobs
    runningJobs.forEach(job => {
      if (!eventSourcesRef.current[job.job_id]) {
        connectToJobStream(job.job_id);
      }
    });
    
    // Disconnect from jobs that are no longer running
    Object.keys(eventSourcesRef.current).forEach(jobId => {
      if (!runningJobs.some(j => j.job_id === jobId)) {
        disconnectFromJobStream(jobId);
      }
    });
  }, [jobs, connectToJobStream, disconnectFromJobStream]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(eventSourcesRef.current).forEach(es => es.close());
    };
  }, []);

  // Merge live updates with job data
  const mergedJobs = useMemo(() => {
    return jobs.map(job => {
      const liveData = liveUpdates[job.job_id];
      if (liveData) {
        return {
          ...job,
          progress: liveData.progress ?? job.progress,
          state: liveData.state ?? job.state,
          current_epoch: liveData.current_epoch ?? job.current_epoch,
          total_epochs: liveData.total_epochs ?? job.total_epochs,
          metrics: {
            ...job.metrics,
            ...liveData.metrics,
          },
        };
      }
      return job;
    });
  }, [jobs, liveUpdates]);

  // Handle new training submission
  const handleNewTraining = async (request: TrainingRequest) => {
    setIsSubmitting(true);
    try {
      const response = await startTraining(request);
      toast({
        title: '학습 시작됨',
        description: `${response.model_name} 모델 학습이 시작되었습니다.`,
      });
      fetchData();
    } catch (e) {
      toast({
        title: '학습 시작 실패',
        description: e instanceof Error ? e.message : '알 수 없는 오류',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle job cancellation
  const handleCancelJob = async (jobId: string) => {
    try {
      await cancelTrainingJob(jobId);
      toast({
        title: '학습 취소됨',
        description: '학습 작업이 취소되었습니다.',
      });
      fetchData();
    } catch (e) {
      toast({
        title: '취소 실패',
        description: e instanceof Error ? e.message : '알 수 없는 오류',
        variant: 'destructive',
      });
    }
  };

  // Handle model download
  const handleDownloadModel = async (jobId: string) => {
    try {
      const blob = await downloadModelArtifact(jobId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `model-${jobId}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({
        title: '다운로드 시작',
        description: '모델 파일 다운로드가 시작되었습니다.',
      });
    } catch (e) {
      toast({
        title: '다운로드 실패',
        description: e instanceof Error ? e.message : '알 수 없는 오류',
        variant: 'destructive',
      });
    }
  };

  // Handle inference test
  const handleInference = (jobId: string) => {
    const job = mergedJobs.find((j) => j.job_id === jobId);
    if (job) {
      setInferenceJob({ jobId, modelName: job.model_name });
    }
  };

  const runningJobs = mergedJobs.filter((j) => j.state === 'RUNNING' || j.state === 'INITIALIZING' || j.state === 'PENDING');
  const completedJobs = mergedJobs.filter((j) => j.state === 'COMPLETED');
  const failedJobs = mergedJobs.filter((j) => j.state === 'FAILED' || j.state === 'CANCELLED');
  
  // Count live connections
  const liveConnectionCount = Object.keys(sseConnected).filter(k => sseConnected[k]).length;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-6xl">
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
              <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                ML 모델 학습
              </h1>
              <p className="text-muted-foreground">
                HuggingFace 기반 ML 모델을 학습하고 관리합니다.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {liveConnectionCount > 0 && (
                <Badge variant="outline" className="animate-pulse border-green-500 text-green-600">
                  <Radio className="h-3 w-3 mr-1" />
                  Live ({liveConnectionCount})
                </Badge>
              )}
              <Button variant="outline" size="sm" onClick={fetchData}>
                <RefreshCw className="h-4 w-4 mr-2" />
                새로고침
              </Button>
              <Button onClick={() => setIsNewTrainingOpen(true)}>
                <Play className="h-4 w-4 mr-2" />
                새 학습 시작
              </Button>
            </div>
          </div>
        </header>

        {/* Health Status */}
        {health ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <MetricCard
              label="서비스 상태"
              value={health.status === 'healthy' ? '정상' : '비정상'}
              icon={health.status === 'healthy' ? CheckCircle2 : XCircle}
            />
            <MetricCard
              label="GPU 사용 가능"
              value={health.gpu_available ? '예' : '아니오'}
              icon={Cpu}
            />
            <MetricCard
              label="활성 작업"
              value={`${health.active_jobs} / ${health.max_concurrent_jobs}`}
              icon={Activity}
            />
            <MetricCard
              label="저장된 작업"
              value={health.persisted_jobs}
              icon={HardDrive}
            />
          </div>
        ) : (
          <Alert variant="destructive" className="mb-8">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>연결 실패</AlertTitle>
            <AlertDescription>
              ML Trainer 서비스에 연결할 수 없습니다. 서비스가 실행 중인지 확인하세요.
            </AlertDescription>
          </Alert>
        )}

        {/* Main Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="jobs" className="gap-2">
              <Activity className="h-4 w-4" />
              학습 작업
              {runningJobs.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {runningJobs.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="models" className="gap-2">
              <Layers className="h-4 w-4" />
              학습된 모델
              {models.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {models.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="datasets" className="gap-2">
              <Database className="h-4 w-4" />
              데이터셋
            </TabsTrigger>
          </TabsList>

          {/* Jobs Tab */}
          <TabsContent value="jobs" className="space-y-6">
            {runningJobs.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <PlayCircle className="h-5 w-5 text-green-500" />
                  진행 중인 학습
                </h3>
                {runningJobs.map((job) => (
                  <TrainingJobCard
                    key={job.job_id}
                    job={job}
                    onCancel={handleCancelJob}
                    onInference={handleInference}
                    onDownload={handleDownloadModel}
                    isLive={sseConnected[job.job_id]}
                  />
                ))}
              </div>
            )}

            {completedJobs.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  완료된 학습
                </h3>
                {completedJobs.map((job) => (
                  <TrainingJobCard
                    key={job.job_id}
                    job={job}
                    onCancel={handleCancelJob}
                    onInference={handleInference}
                    onDownload={handleDownloadModel}
                    isLive={false}
                  />
                ))}
              </div>
            )}

            {failedJobs.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-red-500" />
                  실패/취소된 학습
                </h3>
                {failedJobs.slice(0, 5).map((job) => (
                  <TrainingJobCard
                    key={job.job_id}
                    job={job}
                    onCancel={handleCancelJob}
                    onInference={handleInference}
                    onDownload={handleDownloadModel}
                    isLive={false}
                  />
                ))}
              </div>
            )}

            {jobs.length === 0 && (
              <div className="text-center py-16">
                <Brain className="h-16 w-16 mx-auto text-muted-foreground/50 mb-4" />
                <h3 className="text-xl font-semibold mb-2">학습 작업이 없습니다</h3>
                <p className="text-muted-foreground mb-4">
                  새 ML 모델 학습을 시작해보세요.
                </p>
                <Button onClick={() => setIsNewTrainingOpen(true)}>
                  <Play className="h-4 w-4 mr-2" />
                  새 학습 시작
                </Button>
              </div>
            )}
          </TabsContent>

          {/* Models Tab */}
          <TabsContent value="models" className="space-y-4">
            {models.length > 0 ? (
              <div className="grid gap-4">
                {models.map((model) => (
                  <Card key={model.model_path}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-semibold">{model.model_name}</h4>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline">{model.model_type}</Badge>
                            <Badge variant="secondary">{model.framework}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {(model.size_bytes / 1024 / 1024).toFixed(2)} MB
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="outline" size="icon">
                                  <Zap className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>테스트</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="outline" size="icon">
                                  <Download className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>다운로드</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </div>
                      {model.metrics && Object.keys(model.metrics).length > 0 && (
                        <div className="grid grid-cols-4 gap-2 mt-4 text-sm">
                          {Object.entries(model.metrics).slice(0, 4).map(([key, value]) => (
                            <div key={key} className="p-2 rounded bg-muted/50">
                              <p className="text-xs text-muted-foreground capitalize">{key.replace('_', ' ')}</p>
                              <p className="font-mono">{typeof value === 'number' ? value.toFixed(4) : value}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-16">
                <Layers className="h-16 w-16 mx-auto text-muted-foreground/50 mb-4" />
                <h3 className="text-xl font-semibold mb-2">학습된 모델이 없습니다</h3>
                <p className="text-muted-foreground">
                  학습이 완료되면 여기에 모델이 표시됩니다.
                </p>
              </div>
            )}
          </TabsContent>

          {/* Datasets Tab */}
          <TabsContent value="datasets" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {KOREAN_DATASETS.map((dataset) => (
                <Card key={dataset.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-semibold">{dataset.name}</h4>
                        <p className="text-sm text-muted-foreground mt-1">{dataset.description}</p>
                      </div>
                      <a
                        href={`https://huggingface.co/datasets/${dataset.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <Badge variant="outline">{dataset.size}</Badge>
                      <Badge variant="secondary">{MODEL_TYPE_LABELS[dataset.task as MLModelType] || dataset.task}</Badge>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {dataset.downloads.toLocaleString()} downloads
                      </span>
                    </div>
                    <Button
                      className="w-full mt-3"
                      variant="outline"
                      onClick={() => {
                        setIsNewTrainingOpen(true);
                      }}
                    >
                      <Play className="h-4 w-4 mr-2" />
                      이 데이터셋으로 학습
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>

        {/* New Training Dialog */}
        <NewTrainingDialog
          open={isNewTrainingOpen}
          onOpenChange={setIsNewTrainingOpen}
          onSubmit={handleNewTraining}
          isSubmitting={isSubmitting}
        />

        {/* Inference Dialog */}
        {inferenceJob && (
          <InferenceDialog
            open={!!inferenceJob}
            onOpenChange={(open) => !open && setInferenceJob(null)}
            jobId={inferenceJob.jobId}
            modelName={inferenceJob.modelName}
          />
        )}
      </div>
    </div>
  );
};

export default MLTraining;
