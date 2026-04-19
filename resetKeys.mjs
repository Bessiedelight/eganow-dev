import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { execSync } from "child_process";

async function main() {
  const keys = await generateKeyPair("RS256");
  const privateKey = await exportPKCS8(keys.privateKey);
  const publicKey = await exportJWK(keys.publicKey);
  const jwks = JSON.stringify({ keys: [{ use: "sig", ...publicKey }] });

  const JWT_PRIVATE_KEY = privateKey.trimEnd().replace(/\n/g, " ");

  // Set both env vars using the exact same method the CLI uses
  const escape = (v) => v.replace(/"/g, '\\"');
  
  console.log("Setting JWT_PRIVATE_KEY...");
  execSync(`npx convex env set -- JWT_PRIVATE_KEY "${escape(JWT_PRIVATE_KEY)}"`, { stdio: "inherit" });
  
  console.log("Setting JWKS...");
  execSync(`npx convex env set -- JWKS "${escape(jwks)}"`, { stdio: "inherit" });
  
  console.log("\n✅ Both keys set successfully!");
}

main().catch(console.error);
