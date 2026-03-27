import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

import { getIndentGuideOffsets, getItemPadding } from "./constants";

export const LoadingRow = ({
  className,
  level = 0,
}: {
  className?: string;
  level?: number;
}) => {
  const guideOffsets = getIndentGuideOffsets(level);

  return (
    <div className="relative">
      {guideOffsets.length > 0 && (
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0">
          {guideOffsets.map((offset) => (
            <span
              key={offset}
              className="absolute inset-y-1 w-px bg-border/45"
              style={{ left: offset }}
            />
          ))}
        </div>
      )}
      <div
        className={cn(
          "flex h-6 items-center rounded-md text-muted-foreground",
          className,
        )}
        style={{ paddingLeft: getItemPadding(level, true) }}
      >
        <Spinner className="ml-0.5 size-4 text-ring" />
      </div>
    </div>
  );
};
