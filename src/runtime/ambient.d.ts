declare module "@xenova/transformers" {
  export function pipeline(task: string, model: string): Promise<(text: string, options?: Record<string, unknown>) => Promise<unknown>>;
}

declare module "*.css";
declare module "*.css?url" {
  const url: string;
  export default url;
}
