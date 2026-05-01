"use client";

import { ChangeEvent, useCallback, useRef, useState } from "react";
import { FileIcon, FolderOpenIcon, LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/errors";
import { useCreateFile } from "@/features/projects/hooks/use-files";
import { useIsProjectProcessing } from "@/features/conversations/hooks/use-conversations";
import { OrbitBuildingAnimation } from "./building-animation";

import { Id } from "../../../../convex/_generated/dataModel";

type DirectoryInputElement = HTMLInputElement & {
  webkitdirectory?: boolean;
  directory?: boolean;
};

const normalizePath = (value: string) =>
  value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");

export const WelcomeTab = ({
  projectId,
  onOpenFile,
}: {
  projectId: Id<"projects">;
  onOpenFile: (fileId: Id<"files">) => void;
}) => {
  const createFile = useCreateFile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const isBuilding = useIsProjectProcessing(projectId);

  const importSingleFile = useCallback(
    async (file: File) => {
      const content = await file.text();
      const fileId = await createFile({
        projectId,
        name: file.name,
        content,
      });

      onOpenFile(fileId);
      toast.success(`Opened ${file.name}`);
    },
    [createFile, onOpenFile, projectId],
  );

  const importFolder = useCallback(
    async (files: FileList) => {
      const entries = Array.from(files)
        .map((file) => {
          const webkitRelativePath = (
            file as File & { webkitRelativePath?: string }
          ).webkitRelativePath;
          const path = normalizePath(webkitRelativePath || file.name);
          return { file, path };
        })
        .filter((entry) => entry.path.length > 0);

      if (entries.length === 0) {
        toast.error("No files found in selected folder.");
        return;
      }

      let firstImportedFileId: Id<"files"> | null = null;
      let importedCount = 0;
      let failedCount = 0;
      let firstError: unknown;

      for (const entry of entries) {
        try {
          const content = await entry.file.text();
          const importedId = await createFile({
            projectId,
            name: entry.path,
            content,
          });

          if (!firstImportedFileId) {
            firstImportedFileId = importedId;
          }
          importedCount += 1;
        } catch (error) {
          failedCount += 1;
          firstError ??= error;
        }
      }

      if (firstImportedFileId) {
        onOpenFile(firstImportedFileId);
      }

      if (failedCount === 0) {
        toast.success(
          `Imported ${importedCount} file${importedCount === 1 ? "" : "s"}.`,
        );
        return;
      }

      if (importedCount === 0) {
        toast.error(getErrorMessage(firstError, "Unable to import folder."));
        return;
      }

      toast.error(
        `Imported ${importedCount} file${
          importedCount === 1 ? "" : "s"
        }, ${failedCount} failed.`,
      );
    },
    [createFile, onOpenFile, projectId],
  );

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";

      if (!file) {
        return;
      }

      setIsImporting(true);
      try {
        await importSingleFile(file);
      } catch (error) {
        toast.error(getErrorMessage(error, "Unable to open file."));
      } finally {
        setIsImporting(false);
      }
    },
    [importSingleFile],
  );

  const handleFolderChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = event.target.files;
      event.target.value = "";

      if (!selectedFiles || selectedFiles.length === 0) {
        return;
      }

      setIsImporting(true);
      try {
        await importFolder(selectedFiles);
      } finally {
        setIsImporting(false);
      }
    },
    [importFolder],
  );

  const openFolderPicker = useCallback(() => {
    const input = folderInputRef.current as DirectoryInputElement | null;
    if (!input) {
      return;
    }

    input.webkitdirectory = true;
    input.directory = true;
    input.multiple = true;
    input.click();
  }, []);

  if (isBuilding) {
    return <OrbitBuildingAnimation />;
  }

  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto bg-background p-8">
      <div className="w-full max-w-lg space-y-7 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-card">
          <FileIcon className="size-5 text-muted-foreground" />
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            Start coding
          </h2>
          <p className="mx-auto max-w-sm text-sm leading-6 text-muted-foreground">
            Open a file or import a folder to begin working in this project.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-md border-border bg-card px-5 font-medium text-foreground hover:bg-muted hover:text-foreground"
            disabled={isImporting}
            onClick={() => fileInputRef.current?.click()}
          >
            <FileIcon className="size-4 text-muted-foreground" />
            Open file
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-md border-border bg-card px-5 font-medium text-foreground hover:bg-muted hover:text-foreground"
            disabled={isImporting}
            onClick={openFolderPicker}
          >
            <FolderOpenIcon className="size-4 text-muted-foreground" />
            Open folder
          </Button>
        </div>

        {isImporting && (
          <div className="flex items-center justify-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" />
            Importing...
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        onChange={handleFolderChange}
      />
    </div>
  );
};
