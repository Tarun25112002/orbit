import { NameInputRow } from "./name-input-row";

export const CreateInput = ({
  type,
  level,
  onSubmit,
  onCancel,
}: {
  type: "file" | "folder";
  level: number;
  onSubmit: (name: string) => Promise<void> | void;
  onCancel: () => void;
}) => {
  return (
    <NameInputRow
      type={type}
      mode="create"
      level={level}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  );
};
