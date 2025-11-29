import { useState, useCallback, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  ArrowLeft,
  RefreshCw,
  Trash2,
  Play,
  Hand,
  MousePointer,
  Type,
  Navigation,
  Eye,
  Send,
  Pause,
  Camera,
  Globe,
  MonitorPlay,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  checkBrowserUseHealth,
  startBrowserTask,
  getBrowserJobStatus,
  submitIntervention,
  requestManualIntervention,
  cancelBrowserJob,
  getBrowserWSUrl,
  type BrowserJobStatus,
  type BrowserJobStatusResponse,
  type BrowserWSMessage,
  type HumanAction,
  type InterventionType,
} from "@/lib/api";

const STATUS_CONFIG: Record<BrowserJobStatus, { label: string; icon: typeof Clock; color: string }> = {
  pending: { label: "Pending", icon: Clock, color: "bg-yellow-500" },
  running: { label: "Running", icon: Loader2, color: "bg-blue-500" },
  waiting_human: { label: "Needs Help", icon: Hand, color: "bg-orange-500" },
  completed: { label: "Completed", icon: CheckCircle2, color: "bg-green-500" },
  failed: { label: "Failed", icon: XCircle, color: "bg-red-500" },
  cancelled: { label: "Cancelled", icon: XCircle, color: "bg-gray-500" },
};

const INTERVENTION_CONFIG: Record<InterventionType, { label: string; description: string }> = {
  captcha: { label: "CAPTCHA", description: "Solve verification challenge" },
  login: { label: "Login", description: "Authentication required" },
  navigation: { label: "Navigation", description: "Help navigate the page" },
  extraction: { label: "Extraction", description: "Help extract content" },
  confirmation: { label: "Confirmation", description: "Confirm before proceeding" },
  custom: { label: "Custom", description: "Custom intervention" },
};

interface InterventionPanelProps {
  job: BrowserJobStatusResponse;
  onSubmit: (action: HumanAction) => void;
  isSubmitting: boolean;
}

const InterventionPanel = ({ job, onSubmit, isSubmitting }: InterventionPanelProps) => {
  const [actionType, setActionType] = useState<HumanAction["action_type"]>("click");
  const [selector, setSelector] = useState("");
  const [value, setValue] = useState("");
  const [clickX, setClickX] = useState<number | undefined>();
  const [clickY, setClickY] = useState<number | undefined>();
  const [customScript, setCustomScript] = useState("");
  const [message, setMessage] = useState("");

  const handleSubmit = () => {
    const action: HumanAction = {
      action_type: actionType,
      selector: selector || undefined,
      value: value || undefined,
      x: clickX,
      y: clickY,
      custom_script: customScript || undefined,
      message: message || undefined,
    };
    onSubmit(action);
  };

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = e.currentTarget.naturalWidth / rect.width;
    const scaleY = e.currentTarget.naturalHeight / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    setClickX(x);
    setClickY(y);
    setActionType("click");
  };

  const interventionInfo = job.intervention_type ? INTERVENTION_CONFIG[job.intervention_type] : null;

  return (
    <Card className="border-orange-500 border-2">
      <CardHeader className="bg-orange-50 dark:bg-orange-900/20">
        <div className="flex items-center gap-2">
          <Hand className="h-5 w-5 text-orange-500" />
          <CardTitle className="text-lg">Human Intervention Required</CardTitle>
        </div>
        {interventionInfo && (
          <CardDescription>
            <Badge variant="outline" className="mr-2">{interventionInfo.label}</Badge>
            {interventionInfo.description}
          </CardDescription>
        )}
        {job.intervention_reason && (
          <p className="text-sm text-muted-foreground mt-2">{job.intervention_reason}</p>
        )}
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {/* Screenshot with click support */}
        {job.intervention_screenshot && (
          <div className="relative">
            <Label className="text-sm font-medium mb-2 block">
              Browser View (Click to select position)
            </Label>
            <div className="border rounded-lg overflow-hidden cursor-crosshair relative">
              <img
                src={`data:image/jpeg;base64,${job.intervention_screenshot}`}
                alt="Browser screenshot"
                className="w-full"
                onClick={handleImageClick}
              />
              {clickX !== undefined && clickY !== undefined && (
                <div
                  className="absolute w-4 h-4 bg-red-500 rounded-full border-2 border-white transform -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ left: `${(clickX / 1920) * 100}%`, top: `${(clickY / 1080) * 100}%` }}
                />
              )}
            </div>
            {job.current_url && (
              <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                <Globe className="h-3 w-3" />
                <span className="truncate">{job.current_url}</span>
              </div>
            )}
          </div>
        )}

        {/* Action Type */}
        <div className="space-y-2">
          <Label>Action Type</Label>
          <Select value={actionType} onValueChange={(v) => setActionType(v as HumanAction["action_type"])}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="click">
                <div className="flex items-center gap-2">
                  <MousePointer className="h-4 w-4" /> Click
                </div>
              </SelectItem>
              <SelectItem value="type">
                <div className="flex items-center gap-2">
                  <Type className="h-4 w-4" /> Type Text
                </div>
              </SelectItem>
              <SelectItem value="navigate">
                <div className="flex items-center gap-2">
                  <Navigation className="h-4 w-4" /> Navigate to URL
                </div>
              </SelectItem>
              <SelectItem value="scroll">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4" /> Scroll
                </div>
              </SelectItem>
              <SelectItem value="custom">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4" /> Custom Script
                </div>
              </SelectItem>
              <SelectItem value="skip">
                <div className="flex items-center gap-2">
                  <Play className="h-4 w-4" /> Skip (Continue)
                </div>
              </SelectItem>
              <SelectItem value="abort">
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4" /> Abort Task
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Action-specific inputs */}
        {(actionType === "click" || actionType === "type") && (
          <div className="space-y-2">
            <Label>CSS Selector (optional if clicking on screenshot)</Label>
            <Input
              value={selector}
              onChange={(e) => setSelector(e.target.value)}
              placeholder="e.g., #submit-btn, .login-button, input[name='email']"
            />
          </div>
        )}

        {actionType === "click" && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>X Coordinate</Label>
              <Input
                type="number"
                value={clickX ?? ""}
                onChange={(e) => setClickX(e.target.value ? parseInt(e.target.value) : undefined)}
                placeholder="X position"
              />
            </div>
            <div className="space-y-2">
              <Label>Y Coordinate</Label>
              <Input
                type="number"
                value={clickY ?? ""}
                onChange={(e) => setClickY(e.target.value ? parseInt(e.target.value) : undefined)}
                placeholder="Y position"
              />
            </div>
          </div>
        )}

        {actionType === "type" && (
          <div className="space-y-2">
            <Label>Text to Type</Label>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Enter text to type"
            />
          </div>
        )}

        {actionType === "navigate" && (
          <div className="space-y-2">
            <Label>URL</Label>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="https://example.com"
            />
          </div>
        )}

        {actionType === "scroll" && (
          <div className="space-y-2">
            <Label>Scroll Amount (pixels, negative for up)</Label>
            <Input
              type="number"
              value={clickY ?? 500}
              onChange={(e) => setClickY(parseInt(e.target.value) || 500)}
              placeholder="500"
            />
          </div>
        )}

        {actionType === "custom" && (
          <div className="space-y-2">
            <Label>JavaScript Code</Label>
            <Textarea
              value={customScript}
              onChange={(e) => setCustomScript(e.target.value)}
              placeholder="document.querySelector('button').click();"
              rows={4}
            />
          </div>
        )}

        {/* Message to AI */}
        <div className="space-y-2">
          <Label>Message to AI (optional)</Label>
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Additional context for the AI agent"
          />
        </div>

        {/* Submit buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Submit Action
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => onSubmit({ action_type: "skip" })}
            disabled={isSubmitting}
          >
            Skip
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

const BrowserAgent = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);

  // Form state
  const [task, setTask] = useState("");
  const [url, setUrl] = useState("");
  const [maxSteps, setMaxSteps] = useState(25);
  const [enableIntervention, setEnableIntervention] = useState(true);
  const [autoIntervention, setAutoIntervention] = useState(true);

  // Job state
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [liveScreenshot, setLiveScreenshot] = useState<string | null>(null);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);

  // Health check
  const { data: health } = useQuery({
    queryKey: ["browserUse", "health"],
    queryFn: checkBrowserUseHealth,
    staleTime: 30_000,
    retry: 1,
  });

  const isHealthy = health?.status === "healthy";

  // Job status polling
  const { data: currentJob } = useQuery({
    queryKey: ["browserUse", "job", currentJobId],
    queryFn: () => getBrowserJobStatus(currentJobId!),
    enabled: !!currentJobId,
    refetchInterval: (query) => {
      const data = query.state.data as BrowserJobStatusResponse | undefined;
      if (!data) return 2000;
      if (["completed", "failed", "cancelled"].includes(data.status)) return false;
      return 2000;
    },
    staleTime: 1000,
  });

  // WebSocket connection
  useEffect(() => {
    if (!currentJobId) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
        setWsConnected(false);
      }
      return;
    }

    const wsUrl = getBrowserWSUrl(currentJobId);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setWsConnected(true);
      toast({ title: "Connected", description: "Real-time updates enabled" });
    };

    ws.onmessage = (event) => {
      try {
        const message: BrowserWSMessage = JSON.parse(event.data);

        switch (message.type) {
          case "step_update":
            if (message.screenshot) setLiveScreenshot(message.screenshot);
            if (message.current_url) setLiveUrl(message.current_url);
            queryClient.invalidateQueries({ queryKey: ["browserUse", "job", currentJobId] });
            break;

          case "intervention_requested":
            toast({
              title: "Intervention Needed",
              description: message.reason || "AI agent needs your help",
              variant: "destructive",
            });
            if (message.screenshot) setLiveScreenshot(message.screenshot);
            queryClient.invalidateQueries({ queryKey: ["browserUse", "job", currentJobId] });
            break;

          case "completed":
            toast({
              title: "Task Completed",
              description: "Browser task finished successfully",
            });
            queryClient.invalidateQueries({ queryKey: ["browserUse", "job", currentJobId] });
            break;

          case "failed":
            toast({
              title: "Task Failed",
              description: message.error || "An error occurred",
              variant: "destructive",
            });
            queryClient.invalidateQueries({ queryKey: ["browserUse", "job", currentJobId] });
            break;

          case "cancelled":
            toast({
              title: "Task Cancelled",
              description: "The task was cancelled",
            });
            queryClient.invalidateQueries({ queryKey: ["browserUse", "job", currentJobId] });
            break;

          case "screenshot":
            if (message.data) setLiveScreenshot(message.data);
            if (message.current_url) setLiveUrl(message.current_url);
            break;
        }
      } catch (e) {
        console.error("Failed to parse WebSocket message:", e);
      }
    };

    ws.onerror = () => {
      toast({
        title: "Connection Error",
        description: "WebSocket connection failed",
        variant: "destructive",
      });
    };

    ws.onclose = () => {
      setWsConnected(false);
    };

    wsRef.current = ws;

    return () => {
      ws.close();
    };
  }, [currentJobId, toast, queryClient]);

  // Start task mutation
  const startMutation = useMutation({
    mutationFn: startBrowserTask,
    onSuccess: (response) => {
      setCurrentJobId(response.job_id);
      setLiveScreenshot(null);
      setLiveUrl(null);
      toast({
        title: "Task Started",
        description: `Job ID: ${response.job_id}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Start",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Submit intervention mutation
  const interventionMutation = useMutation({
    mutationFn: (action: HumanAction) => submitIntervention(currentJobId!, action),
    onSuccess: () => {
      toast({
        title: "Action Submitted",
        description: "The AI agent will continue with your input",
      });
      queryClient.invalidateQueries({ queryKey: ["browserUse", "job", currentJobId] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Submit",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Manual intervention request
  const manualInterventionMutation = useMutation({
    mutationFn: () => requestManualIntervention(currentJobId!, "custom", "Manual takeover requested"),
    onSuccess: (response) => {
      if (response.screenshot) setLiveScreenshot(response.screenshot);
      if (response.current_url) setLiveUrl(response.current_url);
      toast({
        title: "Takeover Mode",
        description: "You can now control the browser",
      });
      queryClient.invalidateQueries({ queryKey: ["browserUse", "job", currentJobId] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Cancel job mutation
  const cancelMutation = useMutation({
    mutationFn: () => cancelBrowserJob(currentJobId!),
    onSuccess: () => {
      toast({ title: "Cancelled", description: "Task has been cancelled" });
      queryClient.invalidateQueries({ queryKey: ["browserUse", "job", currentJobId] });
    },
  });

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim()) return;

    startMutation.mutate({
      task: task.trim(),
      url: url.trim() || undefined,
      max_steps: maxSteps,
      headless: false,
      enable_human_intervention: enableIntervention,
      auto_request_intervention: autoIntervention,
    });
  }, [task, url, maxSteps, enableIntervention, autoIntervention, startMutation]);

  const handleReset = useCallback(() => {
    setCurrentJobId(null);
    setTask("");
    setUrl("");
    setLiveScreenshot(null);
    setLiveUrl(null);
    queryClient.removeQueries({ queryKey: ["browserUse", "job"] });
  }, [queryClient]);

  const isProcessing = currentJob && ["pending", "running"].includes(currentJob.status);
  const needsIntervention = currentJob?.status === "waiting_human";
  const isTerminal = currentJob && ["completed", "failed", "cancelled"].includes(currentJob.status);

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
            Back to Main
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold mb-2 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Browser AI Agent
              </h1>
              <p className="text-muted-foreground">
                AI-powered browser automation with human-in-the-loop intervention
              </p>
            </div>
            <div className="flex items-center gap-2">
              {wsConnected ? (
                <Badge variant="secondary" className="flex items-center gap-1">
                  <Wifi className="h-3 w-3 text-green-500" />
                  Live
                </Badge>
              ) : currentJobId ? (
                <Badge variant="outline" className="flex items-center gap-1">
                  <WifiOff className="h-3 w-3 text-red-500" />
                  Disconnected
                </Badge>
              ) : null}
              {health && (
                <Badge variant="outline">
                  {health.active_jobs} active / {health.waiting_intervention} waiting
                </Badge>
              )}
            </div>
          </div>
          {!isHealthy && (
            <div className="mt-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Browser agent service is currently unavailable.
            </div>
          )}
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Task Form & Status */}
          <div className="lg:col-span-1 space-y-6">
            {/* Task Form */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5" />
                  New Task
                </CardTitle>
                <CardDescription>
                  Describe what you want the AI to do in the browser
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="task">Task Description *</Label>
                    <Textarea
                      id="task"
                      value={task}
                      onChange={(e) => setTask(e.target.value)}
                      placeholder="e.g., Go to news.ycombinator.com and extract the top 5 headlines"
                      disabled={isProcessing || needsIntervention}
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="url">Starting URL (optional)</Label>
                    <Input
                      id="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://example.com"
                      disabled={isProcessing || needsIntervention}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="maxSteps">Max Steps</Label>
                    <Input
                      id="maxSteps"
                      type="number"
                      value={maxSteps}
                      onChange={(e) => setMaxSteps(parseInt(e.target.value) || 25)}
                      min={1}
                      max={100}
                      disabled={isProcessing || needsIntervention}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="enableIntervention">Human Intervention</Label>
                    <Switch
                      id="enableIntervention"
                      checked={enableIntervention}
                      onCheckedChange={setEnableIntervention}
                      disabled={isProcessing || needsIntervention}
                    />
                  </div>

                  {enableIntervention && (
                    <div className="flex items-center justify-between">
                      <Label htmlFor="autoIntervention">Auto-detect Issues</Label>
                      <Switch
                        id="autoIntervention"
                        checked={autoIntervention}
                        onCheckedChange={setAutoIntervention}
                        disabled={isProcessing || needsIntervention}
                      />
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      disabled={!task.trim() || isProcessing || needsIntervention || !isHealthy}
                      className="flex-1"
                    >
                      {startMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Starting...
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4 mr-2" />
                          Start Task
                        </>
                      )}
                    </Button>
                    {(currentJob || isTerminal) && (
                      <Button type="button" variant="outline" onClick={handleReset}>
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </form>
              </CardContent>
            </Card>

            {/* Job Status */}
            {currentJob && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center justify-between">
                    <span>Job Status</span>
                    <Badge className={STATUS_CONFIG[currentJob.status].color}>
                      {STATUS_CONFIG[currentJob.status].label}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    Job ID: {currentJob.job_id}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Progress</span>
                      <span>{currentJob.current_step} / {currentJob.max_steps} steps</span>
                    </div>
                    <Progress value={currentJob.progress * 100} />
                  </div>

                  {currentJob.urls_visited.length > 0 && (
                    <div>
                      <Label className="text-sm">Visited URLs</Label>
                      <div className="mt-1 max-h-32 overflow-y-auto space-y-1">
                        {currentJob.urls_visited.map((visitedUrl, i) => (
                          <div key={i} className="text-xs text-muted-foreground flex items-center gap-1">
                            <Globe className="h-3 w-3 shrink-0" />
                            <a
                              href={visitedUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="truncate hover:underline"
                            >
                              {visitedUrl}
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {currentJob.result && (
                    <div>
                      <Label className="text-sm">Result</Label>
                      <div className="mt-1 p-2 bg-muted rounded text-xs max-h-40 overflow-y-auto whitespace-pre-wrap">
                        {currentJob.result}
                      </div>
                    </div>
                  )}

                  {currentJob.error && (
                    <div className="p-2 bg-destructive/10 text-destructive rounded text-sm">
                      {currentJob.error}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    {isProcessing && enableIntervention && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => manualInterventionMutation.mutate()}
                        disabled={manualInterventionMutation.isPending}
                      >
                        <Hand className="h-4 w-4 mr-1" />
                        Take Over
                      </Button>
                    )}
                    {(isProcessing || needsIntervention) && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => cancelMutation.mutate()}
                        disabled={cancelMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Column: Browser View & Intervention */}
          <div className="lg:col-span-2 space-y-6">
            {/* Intervention Panel */}
            {needsIntervention && currentJob && (
              <InterventionPanel
                job={currentJob}
                onSubmit={(action) => interventionMutation.mutate(action)}
                isSubmitting={interventionMutation.isPending}
              />
            )}

            {/* Live Browser View */}
            {currentJobId && !needsIntervention && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <MonitorPlay className="h-5 w-5" />
                    Live Browser View
                  </CardTitle>
                  {liveUrl && (
                    <CardDescription className="flex items-center gap-2">
                      <Globe className="h-3 w-3" />
                      <a
                        href={liveUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline truncate"
                      >
                        {liveUrl}
                      </a>
                      <ExternalLink className="h-3 w-3" />
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  {liveScreenshot ? (
                    <div className="border rounded-lg overflow-hidden">
                      <img
                        src={`data:image/jpeg;base64,${liveScreenshot}`}
                        alt="Live browser view"
                        className="w-full"
                      />
                    </div>
                  ) : (
                    <div className="h-64 flex items-center justify-center bg-muted rounded-lg">
                      {isProcessing ? (
                        <div className="text-center text-muted-foreground">
                          <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin" />
                          <p>Waiting for browser updates...</p>
                        </div>
                      ) : (
                        <div className="text-center text-muted-foreground">
                          <Camera className="h-8 w-8 mx-auto mb-2" />
                          <p>No screenshot available</p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Empty State */}
            {!currentJobId && (
              <Card>
                <CardContent className="py-16">
                  <div className="text-center">
                    <div className="inline-block p-4 rounded-full bg-accent/10 mb-4">
                      <Bot className="h-12 w-12 text-accent" />
                    </div>
                    <h2 className="text-xl font-semibold mb-2">Ready to Browse</h2>
                    <p className="text-muted-foreground max-w-md mx-auto">
                      Describe a task and the AI agent will automate browser actions.
                      You can take control at any time if the agent needs help.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Completed State */}
            {isTerminal && currentJob && (
              <Card>
                <CardContent className="py-8">
                  <div className="text-center">
                    {currentJob.status === "completed" ? (
                      <>
                        <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-4" />
                        <h2 className="text-xl font-semibold mb-2">Task Completed</h2>
                        <p className="text-muted-foreground">
                          Visited {currentJob.urls_visited.length} pages in {currentJob.current_step} steps
                        </p>
                      </>
                    ) : currentJob.status === "failed" ? (
                      <>
                        <XCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
                        <h2 className="text-xl font-semibold mb-2">Task Failed</h2>
                        <p className="text-muted-foreground">{currentJob.error}</p>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                        <h2 className="text-xl font-semibold mb-2">Task Cancelled</h2>
                      </>
                    )}
                    <Button onClick={handleReset} className="mt-4">
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Start New Task
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BrowserAgent;
