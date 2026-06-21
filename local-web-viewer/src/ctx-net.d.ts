// ctx.net ships in the next silo release alongside this extension.
// This augmentation lets the extension compile against the currently-published
// SDK. Remove once @silo-code/sdk exports NetworkService and ExtensionContext
// already includes `net`.

export interface NetworkRequestOptions {
  method?: "GET" | "HEAD" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: string;
  followRedirects?: boolean;
  timeoutMs?: number;
}

export interface NetworkResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  finalUrl: string;
}

export interface NetworkService {
  fetch(url: string, options?: NetworkRequestOptions): Promise<NetworkResponse>;
  fetchHeaders(
    url: string,
    options?: Pick<NetworkRequestOptions, "followRedirects" | "timeoutMs">,
  ): Promise<Record<string, string>>;
}

declare module "@silo-code/sdk" {
  interface ExtensionContext {
    readonly net: NetworkService;
  }
}
