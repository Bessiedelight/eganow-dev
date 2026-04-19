import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { writeFileSync } from "fs";

const keys = await generateKeyPair("RS256", { extractable: true });
const privateKey = await exportPKCS8(keys.privateKey);
const publicKey = await exportJWK(keys.publicKey);
const jwks = JSON.stringify({ keys: [{ use: "sig", ...publicKey }] });

const privKeyOneLine = privateKey.trimEnd().replace(/\n/g, " ");

writeFileSync("generated_keys.txt", `JWT_PRIVATE_KEY=${privKeyOneLine}\nJWKS=${jwks}\n`);
console.log("Keys written to generated_keys.txt");
