import type { CmsContentFile, CmsNode } from "../shared/types.js";

export interface RuntimeState {
  content: CmsContentFile;
  byId: Map<string, CmsNode>;
}

export interface RuntimeLocaleMap {
  [lang: string]: Record<string, string>;
}
