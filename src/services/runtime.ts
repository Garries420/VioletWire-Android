export interface TextStore {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
}
export interface ServiceRuntime {
  fetch: typeof fetch;
  openExternal(url: string): Promise<void>;
  openAuthentication?(url: string): Promise<void>;
  tokenStore: TextStore;
  clientId?: string;
  waitForForeground?(signal: AbortSignal): Promise<void>;
  onSignInStatus?(message: string): void;
}
