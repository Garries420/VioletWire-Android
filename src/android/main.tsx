import React from "react";
import ReactDOM from "react-dom/client";
import { App as CapacitorApp } from "@capacitor/app";
import "@fontsource-variable/inter/index.css";
import { AppErrorBoundary } from "../renderer/src/AppErrorBoundary";
import "../renderer/src/styles.css";
import "./android.css";
import {
  androidPlatform,
  initializePlatform,
  pauseChat,
  resumeChat,
  foregroundGate,
  androidUpdates,
} from "./platform";
import { VioletNative } from "./native";
import { installDpadNavigation } from "./navigation";
import { AndroidPlayerChrome } from "./AndroidPlayerChrome";
import { AndroidLibrary } from "./AndroidLibrary";
import { AndroidHome } from "./AndroidHome";
import { AndroidUpdateNotice } from "./AndroidUpdateNotice";

window.desktop = androidPlatform;
window.violetwireRuntime = { platform: "android" };
document.documentElement.classList.add("android");
document.getElementById("root")!.textContent = "Starting VioletWire Android…";
installDpadNavigation();

async function start() {
  await VioletNative.addListener("keyboardVisibility", ({ visible }) => {
    document.documentElement.dataset.androidKeyboardVisible = String(visible);
  });
  const info = await VioletNative.deviceInfo();
  if (info.television) document.documentElement.classList.add("android-tv");
  let startupError = "";
  try {
    await initializePlatform();
  } catch (error) {
    startupError = error instanceof Error ? error.message : String(error);
  }
  // Renderer modules subscribe to platform preferences during module evaluation.
  // Load them only after the Android adapter has been installed and initialized.
  const { App } = await import("../renderer/src/App");
  foregroundGate.setActive((await CapacitorApp.getState()).isActive);
  await CapacitorApp.addListener("appStateChange", ({ isActive }) => {
    foregroundGate.setActive(isActive);
    if (isActive) { resumeChat(); window.dispatchEvent(new Event("android-stream-refresh")); }
    else pauseChat();
  });
  await CapacitorApp.addListener("backButton", () => {
    const back = new Event("android-back", { cancelable: true });
    if (window.dispatchEvent(back)) void CapacitorApp.exitApp();
  });
  window.addEventListener("android-background-player", () => {
    void VioletNative.pictureInPicture().catch((error) =>
      window.dispatchEvent(
        new CustomEvent("android-notice", { detail: String(error) }),
      ),
    );
  });
  window.addEventListener("android-player-metadata", (event) => {
    void VioletNative.metadata((event as CustomEvent<{ channel: string; viewers: number; startedAt: number; followed: boolean; subscribed: boolean; pending: boolean; chatVisible: boolean }>).detail);
  });
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <App />
        <AndroidPlayerChrome />
        <AndroidHome />
        <AndroidLibrary />
        <AndroidUpdateNotice />
        {startupError && (
          <div className="android-startup-error" role="alert">
            {startupError}
          </div>
        )}
      </AppErrorBoundary>
    </React.StrictMode>,
  );
  void androidUpdates.check();
}
void start().catch((error) => {
  document.getElementById("root")!.textContent =
    `VioletWire could not start: ${String(error)}`;
});
