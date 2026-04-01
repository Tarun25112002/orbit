"use client";

import { ChangeEvent, useCallback, useRef, useState } from "react";
import { FileIcon, FolderOpenIcon, LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/errors";
import { useCreateFile } from "@/features/projects/hooks/use-files";

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

  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto bg-[#1e1e1e] p-8">
      <div className="w-full max-w-xl space-y-6 text-center">
        <h2 className="text-5xl font-semibold tracking-[0.2em] text-[#d9d9d9]">
          ORBIT
        </h2>
        <p className="text-sm text-[#858585]">
          Open a file or folder to import it into this project.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="border-[#3c3c3c] bg-[#252526] text-[#cccccc] hover:bg-[#2f2f2f]"
            disabled={isImporting}
            onClick={() => fileInputRef.current?.click()}
          >
            <FileIcon className="size-4 text-[#007acc]" />
            Open file
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-[#3c3c3c] bg-[#252526] text-[#cccccc] hover:bg-[#2f2f2f]"
            disabled={isImporting}
            onClick={openFolderPicker}
          >
            <FolderOpenIcon className="size-4 text-[#007acc]" />
            Open folder
          </Button>
        </div>

        {isImporting && (
          <div className="flex items-center justify-center gap-2 text-xs text-[#9a9a9a]">
            <LoaderCircleIcon className="size-4 animate-spin text-[#007acc]" />
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
