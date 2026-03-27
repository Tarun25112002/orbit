import { NameInputRow } from "./name-input-row";

export const RenameInput = ({
  type,
  defaultValue,
  isOpen,
  level,
  onSubmit,
  onCancel,
}: {
  type: "file" | "folder";
  defaultValue: string;
  isOpen?: boolean;
  level: number;
  onSubmit: (name: string) => Promise<void> | void;
  onCancel: () => void;
}) => {
  return (
    <NameInputRow
      type={type}
      mode="rename"
      level={level}
      initialValue={defaultValue}
      isOpen={isOpen}
      focusSelection={type === "file" ? "basename" : "all"}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  );
};
