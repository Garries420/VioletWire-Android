import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "io.github.garries420.violetwire",
  appName: "VioletWire Android",
  webDir: "dist-android",
  // Bridge diagnostics can contain HTTP authorization headers and token records.
  loggingBehavior: "none",
  android: { allowMixedContent: false },
  // MainActivity owns insets so fullscreen can draw beneath a phone cutout,
  // including on older WebViews where CSS safe-area support is incomplete.
  plugins: { SystemBars: { style: "DARK", insetsHandling: "disable" } },
};
export default config;
