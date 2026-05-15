import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/extension.js",
  external: ["vscode"],
  sourcemap: true,
  minify: !watch,
  logLevel: "info",
});

if (watch) {
  await ctx.watch();
  console.log("watching...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
