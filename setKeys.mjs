import { execSync } from "child_process";
import { readFileSync } from "fs";

const content = readFileSync("generated_keys.txt", "utf-8");
const lines = content.trim().split("\n");

for (const line of lines) {
  const eqIndex = line.indexOf("=");
  if (eqIndex === -1) continue;
  const name = line.substring(0, eqIndex);
  const value = line.substring(eqIndex + 1);
  
  console.log(`Setting ${name}...`);
  execSync(`npx convex env set ${name} -- "${value}"`, { stdio: "inherit" });
  console.log(`✓ ${name} set successfully`);
}
