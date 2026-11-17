/**
 * Owner account setup in the terminal: on the first start, and on
 * `npm run reset`. For headless installs the credentials can come from the
 * MALZOB_OWNER_USERNAME and MALZOB_OWNER_PASSWORD environment variables.
 */
import { createInterface } from "node:readline";
import { credentialsProblem, type OwnerStore } from "./owner.ts";

function askLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** Reads a line without echoing it (the terminal shows "*" for each character). */
function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  process.stdout.write(question);
  return new Promise((resolve) => {
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          // Ctrl+C
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else if (ch >= " ") {
          value += ch;
          process.stdout.write("*");
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function askCredentials(): Promise<{ username: string; password: string }> {
  console.log("\nSet up the owner (game master) account. Players join with just a name; only the owner needs a password.");
  for (;;) {
    const username = (await askLine("Owner username: ")).trim();
    const password = await askHidden("Owner password: ");
    const problem = credentialsProblem(username, password);
    if (problem) {
      console.log(problem);
      continue;
    }
    if ((await askHidden("Repeat the password: ")) !== password) {
      console.log("The passwords do not match.");
      continue;
    }
    return { username, password };
  }
}

/**
 * Makes sure an owner account exists (or replaces it when `reset` is true).
 * Returns false if it cannot ask for one (no terminal and no environment variables).
 */
export async function ensureOwner(owner: OwnerStore, reset: boolean): Promise<boolean> {
  if (owner.exists && !reset) return true;
  const fromEnv = process.env.MALZOB_OWNER_USERNAME && process.env.MALZOB_OWNER_PASSWORD;
  let credentials: { username: string; password: string };
  if (fromEnv) {
    credentials = { username: process.env.MALZOB_OWNER_USERNAME!, password: process.env.MALZOB_OWNER_PASSWORD! };
    const problem = credentialsProblem(credentials.username, credentials.password);
    if (problem) {
      console.error(`[malzob] MALZOB_OWNER_USERNAME / MALZOB_OWNER_PASSWORD: ${problem}`);
      return false;
    }
  } else if (process.stdin.isTTY) {
    credentials = await askCredentials();
  } else {
    console.error(
      "[malzob] No owner account yet. Run the server in a terminal to create one, " +
        "or set MALZOB_OWNER_USERNAME and MALZOB_OWNER_PASSWORD.",
    );
    return false;
  }
  owner.set(credentials.username, credentials.password);
  console.log(`[malzob] Owner account "${owner.username}" saved.`);
  return true;
}
