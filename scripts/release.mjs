#!/usr/bin/env node
/**
 * 自动版本计算：读 Git 最新 Tag → Feature +0.1 / Fix +0.0.1 → 校验唯一性 → 写 package.json
 * 禁止硬编码版本号；tag 必须同时通过本地与远端唯一性校验。
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const kind = (process.argv[2] || "feature").toLowerCase();
if (!["feature", "fix"].includes(kind)) {
  console.error("用法: node scripts/release.mjs feature|fix");
  process.exit(2);
}

const sh = (cmd, opts = {}) => execSync(cmd, { encoding: "utf8", ...opts }).trim();

const localTags = sh("git tag -l 'v*'").split("\n").filter(Boolean);
let remoteTags = [];
try {
  remoteTags = sh("git ls-remote --tags origin 'refs/tags/v*'", { timeout: 25000 })
    .split("\n")
    .map((l) => (l.split("refs/tags/")[1] || "").replace(/\^\{\}$/, ""))
    .filter(Boolean);
} catch (e) {
  console.warn("[warn] 远端 tag 读取失败，仅用本地 tag 校验：" + e.message);
}

const parse = (t) => {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(t);
  return m ? { t, M: +m[1], m: +m[2], p: +m[3] } : null;
};
const all = [...new Set([...localTags, ...remoteTags])]
  .map(parse)
  .filter(Boolean)
  .sort((a, b) => a.M - b.M || a.m - b.m || a.p - b.p);
const latest = all.at(-1);
if (!latest) {
  console.error("未找到任何语义化 v* tag，无法递增");
  process.exit(1);
}

const arr = kind === "fix"
  ? [latest.M, latest.m, latest.p + 1]
  : [latest.M, latest.m + 1, 0];
const version = `v${arr.join(".")}`;
const known = new Set([...localTags, ...remoteTags]);
if (known.has(version)) {
  console.error(`版本 ${version} 已存在（本地或远端），禁止重复打 tag`);
  process.exit(1);
}

const pkgPath = "package.json";
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const oldVersion = pkg.version;
pkg.version = arr.join(".");
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

/* 版本号单一来源：前端顶栏读 src/version.js，由本脚本自动写入，禁止手改，避免 package.json 漂移 */
const verPath = "src/version.js";
writeFileSync(
  verPath,
  `/** 版本号唯一来源：由 scripts/release.mjs 自动写入，禁止手改 */\nexport const VERSION = "${arr.join(".")}";\n`
);

console.log(JSON.stringify({
  kind,
  latestTag: latest.t,
  oldPackageVersion: oldVersion,
  newVersion: version,
  unique: true,
  localTagCount: localTags.length,
  remoteTagCount: remoteTags.length,
  versionFile: verPath,
  allKnownTags: [...known].sort(),
}, null, 2));
