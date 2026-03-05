import { readFileSync, writeFileSync } from "fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const current = parseFloat(pkg.version) || 0;
pkg.version = (current + 0.01).toFixed(2);
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
console.log(`Version bumped: ${current.toFixed(2)} → ${pkg.version}`);
