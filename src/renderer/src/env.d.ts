import type { DesktopApi } from "../../shared/player";

declare global {
  interface Window {
    desktop: DesktopApi;
    violetwireRuntime?: { platform: "android" };
  }
}

export {};
