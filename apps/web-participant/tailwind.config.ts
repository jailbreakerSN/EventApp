import type { Config } from "tailwindcss";
import sharedPreset from "@teranga/shared-config/tailwind";

const config: Config = {
  presets: [sharedPreset as Config],
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/shared-ui/src/**/*.{js,ts,jsx,tsx}",
  ],
  plugins: [],
};

export default config;
