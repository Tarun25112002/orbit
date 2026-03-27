// Base padding for root level items (after project header)
export const BASE_PADDING = 12;
// Additional padding per nesting level
export const LEVEL_PADDING = 12;
// Vertical guide offset inside the indentation gutter
export const INDENT_GUIDE_OFFSET = BASE_PADDING + 7;

export const getItemPadding = (level: number, isFile: boolean) => {
  // Files need extra padding since they don't have the chevron
  const fileOffset = isFile ? 16 : 0;
  return BASE_PADDING + level * LEVEL_PADDING + fileOffset;
};

export const getIndentGuideOffsets = (level: number) =>
  Array.from(
    {
      length: level,
    },
    (_, index) => INDENT_GUIDE_OFFSET + index * LEVEL_PADDING,
  );
