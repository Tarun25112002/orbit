const BASE_PADDING = 12;
const LEVEL_PADDING = 12;
const INDENT_GUIDE_OFFSET = BASE_PADDING + 7;

export const getItemPadding = (level: number, isFile: boolean) => {

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
