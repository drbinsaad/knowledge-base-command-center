import { spawnSync } from "node:child_process";
import process from "node:process";

const tag = process.env.GITHUB_REF_NAME || process.argv[2];
const mainReference = process.argv[3] || "origin/main";
if (!tag) throw new Error("A release tag is required through GITHUB_REF_NAME or the first argument.");

function git(arguments_) {
  return spawnSync("git", arguments_, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const resolved = git(["rev-list", "-n", "1", tag]);
if (resolved.status !== 0 || !resolved.stdout.trim()) throw new Error(resolved.stderr.trim() || `Unable to resolve tag ${tag}.`);
const commit = resolved.stdout.trim();
const ancestry = git(["merge-base", "--is-ancestor", commit, mainReference]);
if (ancestry.status === 1) throw new Error(`Release tag ${tag} points to ${commit}, which is not reachable from ${mainReference}.`);
if (ancestry.status !== 0) throw new Error(ancestry.stderr.trim() || `Unable to verify ${tag} against ${mainReference}.`);
process.stdout.write(`Verified ${tag} commit ${commit} is reachable from ${mainReference}.\n`);
