import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Settings, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { authApi } from '@/lib/adminApi';
import type { SetupStatus } from '@/types/admin';
import { cn } from '@/lib/utils';

const DISMISSED_KEY = 'newsinsight_setup_banner_dismissed';

export function SetupBanner() {
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if user has dismissed the banner for this session
    const dismissed = sessionStorage.getItem(DISMISSED_KEY);
    if (dismissed === 'true') {
      setIsDismissed(true);
      setIsLoading(false);
      return;
    }

    // Fetch setup status
    const checkSetup = async () => {
      try {
        const status = await authApi.getSetupStatus();
        setSetupStatus(status);
      } catch (error) {
        // API might not be available yet or setup endpoint doesn't exist
        console.debug('Setup status check failed:', error);
        setSetupStatus(null);
      } finally {
        setIsLoading(false);
      }
    };

    checkSetup();
  }, []);

  const handleDismiss = () => {
    setIsDismissed(true);
    sessionStorage.setItem(DISMISSED_KEY, 'true');
  };

  // Don't show banner if:
  // - Still loading
  // - Already dismissed
  // - No setup status available
  // - Setup is not required (admin already changed password)
  if (isLoading || isDismissed || !setupStatus || !setupStatus.setup_required) {
    return null;
  }

  // Only show if default admin is being used
  if (!setupStatus.is_default_admin) {
    return null;
  }

  return (
    <div
      className={cn(
        'relative bg-amber-500/10 border-b border-amber-500/30',
        'px-4 py-3'
      )}
      role="alert"
    >
      <div className="container flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
            <span className="font-medium text-amber-700 dark:text-amber-400">
              초기 설정이 필요합니다
            </span>
            <span className="text-sm text-muted-foreground">
              기본 관리자 계정(admin/admin123)을 사용 중입니다. 보안을 위해 비밀번호를 변경해주세요.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            asChild
            size="sm"
            className="bg-amber-500 hover:bg-amber-600 text-white gap-2"
          >
            <Link to="/admin/login">
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">설정하기</span>
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={handleDismiss}
            aria-label="배너 닫기"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default SetupBanner;
