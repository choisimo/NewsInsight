import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useQuickAccess } from '@/contexts/QuickAccessContext';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export const QuickAccessButton = () => {
  const { toggle } = useQuickAccess();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          className="relative"
        >
          <Zap className="h-5 w-5" />
          <span className="sr-only">빠른 접근</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>빠른 접근 (Ctrl+Shift+K)</p>
      </TooltipContent>
    </Tooltip>
  );
};
