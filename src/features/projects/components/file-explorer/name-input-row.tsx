import { useRef, useState } from "react";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { getErrorMessage } from "@/lib/errors";

import { getItemPadding } from "./constants";
import { ItemIcon } from "./item-icon";

type FocusSelection = "all" | "basename";

const INVALID_ITEM_NAME_PATTERN = /[\\/]/;

const getNameValidationError = (
  name: string,
  type: "file" | "folder",
) => {
  const label = type === "file" ? "File name" : "Folder name";

  if (name === "." || name === "..") {
    return `${label} cannot be "." or "..".`;
  }

  if (INVALID_ITEM_NAME_PATTERN.test(name)) {
    return `${label} cannot include "/" or "\\".`;
  }

  return null;
};

export const NameInputRow = ({
  type,
  mode,
  level,
  initialValue = "",
  isOpen,
  focusSelection = "all",
  onSubmit,
  onCancel,
}: {
  type: "file" | "folder";
  mode: "create" | "rename";
  level: number;
  initialValue?: string;
  isOpen?: boolean;
  focusSelection?: FocusSelection;
  onSubmit: (name: string) => Promise<void> | void;
  onCancel: () => void;
}) => {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  const resolveSubmitValue = () => {
    const trimmedValue = value.trim();

    if (mode === "rename") {
      return trimmedValue || initialValue.trim();
    }

    return trimmedValue;
  };

  const handleSubmit = async () => {
    if (isSubmittingRef.current) {
      return;
    }

    const nextValue = resolveSubmitValue();
    if (!nextValue) {
      onCancel();
      return;
    }

    const validationError = getNameValidationError(nextValue, type);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      await onSubmit(nextValue);
    } catch (submitError) {
      isSubmittingRef.current = false;
      setError(
        getErrorMessage(submitError, `Unable to ${mode} this ${type}.`),
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <div
        className="flex h-5.5 items-center gap-1 bg-accent/30"
        style={{ paddingLeft: getItemPadding(level, type === "file") }}
      >
        <div className="flex items-center gap-0.5">
          {type === "folder" && (
            <ChevronRightIcon
              className={cn(
                "size-4 shrink-0 text-muted-foreground",
                isOpen && "rotate-90",
              )}
            />
          )}
          <ItemIcon
            type={type}
            name={type === "file" ? value : undefined}
            isOpen={isOpen}
            allowPartialFileMatch
          />
        </div>
        <input
          autoFocus
          type="text"
          value={value}
          disabled={isSubmitting}
          aria-invalid={error ? "true" : "false"}
          onChange={(event) => {
            if (error) {
              setError(null);
            }
            setValue(event.target.value);
          }}
          className="flex-1 bg-transparent text-sm outline-none focus:ring-1 focus:ring-inset focus:ring-ring disabled:cursor-wait disabled:opacity-70"
          onBlur={() => {
            void handleSubmit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleSubmit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              if (!isSubmitting) {
                onCancel();
              }
            }
          }}
          onFocus={(event) => {
            if (focusSelection === "basename") {
              const currentValue = event.currentTarget.value;
              const lastDotIndex = currentValue.lastIndexOf(".");

              if (lastDotIndex > 0) {
                event.currentTarget.setSelectionRange(0, lastDotIndex);
                return;
              }
            }

            event.currentTarget.select();
          }}
        />
        {isSubmitting && <Spinner className="mr-2 size-3.5 text-ring" />}
      </div>
      {error && (
        <p
          className="py-1 pr-2 text-xs text-destructive"
          style={{ paddingLeft: getItemPadding(level, type === "file") + 21 }}
        >
          {error}
        </p>
      )}
    </div>
  );
};
