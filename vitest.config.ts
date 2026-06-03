import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Reuse the app's Vite config (React plugin) so component tests transform JSX
// identically to dev/build. DSP tests are pure but run in the same jsdom env.
export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
			environment: "jsdom",
			include: ["src/**/*.test.{ts,tsx}"],
		},
	}),
);
