export type CmsNodeType = "text" | "image" | "video" | "section" | "property";

export interface SourceRef {
  file: string;
  original: string;
  occurrence?: number;
}

export interface CmsNode {
  id: string;
  key: string;
  type: CmsNodeType;
  label: string;
  value: string;
  selector?: string;
  attrs?: Record<string, string>;
  sourceRefs: SourceRef[];
  sectionItems?: string[];
}

export interface CmsContentFile {
  createdAt: string;
  updatedAt: string;
  nodes: CmsNode[];
}

export interface CmsConfigFile {
  version: 1;
  passcodeSalt: string;
  passcodeHash: string;
  contentFile: string;
  localeDir: string;
  dashboardPath?: string;
  pages?: string[];
}

export interface CmsRuntimeAuthFile {
  version: 1;
  algorithm: "sha256";
  salt: string;
  passcodeHash: string;
}

export interface CmsHostingConfigFile {
  version: 1;
  provider: "none" | "github" | "gitlab";
  repository: string;
  branch: string;
  token?: string;
}

export interface CmsRuntimeSettingsFile {
  version: 1;
  dashboardPath: string;
  pages: string[];
  showFloatingButton: boolean;
  autoTranslateEnabled: boolean;
}

export interface CmsRuntimeLocalesFile {
  version: 1;
  locales: Record<string, Record<string, string>>;
}

export interface CmsPatchOperation {
  file: string;
  find: string;
  replace: string;
  occurrence?: number;
}

export interface CmsPatchFile {
  generatedAt: string;
  content: CmsContentFile;
  operations: CmsPatchOperation[];
  locales?: Record<string, Record<string, string>>;
  integrity?: {
    algorithm: "sha256";
    value: string;
  };
}
