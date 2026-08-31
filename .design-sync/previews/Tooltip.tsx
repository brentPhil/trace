import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  Button,
} from 'chroneli';
import { Play, Info } from 'lucide-react';

/* Tooltip needs its provider in scope. It is composed here rather than set as
 * a global cfg.provider because that is how it is used in the app: a provider
 * near the root of the subtree that owns the tooltips. */

export function Open() {
  return (
    <TooltipProvider>
      <Tooltip open>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="Start timer">
              <Play />
            </Button>
          }
        />
        <TooltipContent>Start the timer</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function WithLongerCopy() {
  return (
    <TooltipProvider>
      <Tooltip open>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="About rounding">
              <Info />
            </Button>
          }
        />
        <TooltipContent className="max-w-56">
          Rounding applies when the entry is exported, never to the tracked
          total.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
