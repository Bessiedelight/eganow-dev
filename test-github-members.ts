import { getGitHubApp } from "./lib/github/app";

async function testFetch() {
  const app = getGitHubApp();
  const { data } = await app.octokit.request("GET /app/installations");
  
  for (const inst of data) {
    console.log(`Installation ID: ${inst.id}, Account: ${inst.account?.login}`);
    try {
      const octokit = await app.getInstallationOctokit(inst.id);
      const res = await octokit.request("GET /orgs/{org}/members", {
        org: inst.account?.login as string
      });
      console.log(`Members length: ${res.data.length}`);
      console.log(res.data.map((m: any) => m.login));
    } catch (e: any) {
      console.error(`Error fetching members for ${inst.account?.login}:`, e.message);
    }
  }
}

testFetch().catch(console.error);
