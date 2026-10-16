import { VioletNative } from "./native";
let finishing = false;
/** Native launch artwork stays on screen until React has its first usable feed. */
export async function finishStartup() {
  if (finishing) return;
  finishing = true;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  document.getElementById("android-startup")?.remove();
  await VioletNative.startupReady();
}
export function startupFailed() {
  void VioletNative.startupReady();
  const splash = document.getElementById("android-startup");
  if (!splash) return;
  splash.querySelector("p")!.textContent = "VioletWire could not start. Please try again.";
  const button = splash.querySelector<HTMLButtonElement>("button")!;
  button.hidden = false;
  button.addEventListener("click", () => location.reload(), { once: true });
}
