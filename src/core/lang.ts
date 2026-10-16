import { extname } from "./paths.ts";

/** Languages whose references the analysis reads. `erb` is Ruby inside templates; `csproj` holds project references. */
export type Lang = "ts" | "py" | "rb" | "erb" | "cs" | "csproj";

const LANG_BY_EXT: Record<string, Lang> = {
  ".ts": "ts",
  ".tsx": "ts",
  ".js": "ts",
  ".jsx": "ts",
  ".mjs": "ts",
  ".cjs": "ts",
  ".py": "py",
  ".rb": "rb",
  ".rake": "rb",
  ".erb": "erb",
  ".cs": "cs",
  ".csproj": "csproj",
};

export function langOf(path: string): Lang | null {
  return LANG_BY_EXT[extname(path).toLowerCase()] ?? null;
}
