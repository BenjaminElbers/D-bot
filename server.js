const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const root = __dirname;
const accountStore = path.join(root, "Account", ".accounts.json");
const accountStoreTemp = `${accountStore}.${process.pid}.tmp`;
const maxRequestBytes = 16 * 1024;
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

let accounts = [];
let accountWriteQueue = Promise.resolve();

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRequestBytes) {
      throw httpError(413, "Request is too large.");
    }
    chunks.push(chunk);
  }

  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "Request must contain valid JSON.");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw httpError(400, "Request must contain a JSON object.");
  }

  return body;
}

function readName(value) {
  if (typeof value !== "string") {
    throw httpError(400, "Enter a name.");
  }

  const name = value.trim();
  if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw httpError(400, "Name must be between 1 and 40 characters.");
  }

  return name;
}

function normalizeName(name) {
  return name.normalize("NFKC").toLowerCase();
}

function findAccount(name) {
  const normalizedName = normalizeName(name);
  return accounts.find((account) => normalizeName(account.name) === normalizedName);
}

function publicAccount(account) {
  return { name: account.name, fullName: account.fullName };
}

async function writeAccounts(nextAccounts) {
  try {
    await fs.writeFile(accountStoreTemp, `${JSON.stringify(nextAccounts, null, 2)}\n`, "utf8");
    await fs.rename(accountStoreTemp, accountStore);
  } catch (error) {
    await fs.rm(accountStoreTemp, { force: true }).catch(() => {});
    throw error;
  }
}

function enqueueAccountWrite(operation) {
  const pendingWrite = accountWriteQueue.then(operation);
  accountWriteQueue = pendingWrite.then(() => undefined, () => undefined);
  return pendingWrite;
}

async function loadAccounts() {
  try {
    const storedAccounts = JSON.parse(await fs.readFile(accountStore, "utf8"));
    if (!Array.isArray(storedAccounts)) {
      throw new Error("Account store must contain a JSON array.");
    }
    return storedAccounts;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  try {
    const legacyName = (await fs.readFile(path.join(root, "Account", "UserName.txt"), "utf8")).trim();
    if (!legacyName) {
      return [];
    }
    return [{ id: randomUUID(), name: legacyName, fullName: legacyName, email: "" }];
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return [];
  }
}

async function handleAccountApi(request, response, pathname) {
  const signInPath = "/api/accounts/sign-in";
  const registerPath = "/api/accounts/register";

  if (pathname !== signInPath && pathname !== registerPath) {
    sendJson(response, 404, { error: "API route not found." });
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const name = readName(body.name);

    if (pathname === signInPath) {
      const account = findAccount(name);
      if (!account) {
        sendJson(response, 404, { error: "No account has that name." });
        return;
      }

      sendJson(response, 200, { account: publicAccount(account) });
      return;
    }

    const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!fullName || fullName.length > 100 || /[\u0000-\u001f\u007f]/.test(fullName)) {
      throw httpError(400, "Enter your full name (up to 100 characters).");
    }
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw httpError(400, "Enter a valid email address.");
    }

    const account = await enqueueAccountWrite(async () => {
      if (findAccount(name)) {
        throw httpError(409, "That name was just registered. Sign in with it instead.");
      }

      const newAccount = {
        id: randomUUID(),
        name,
        fullName,
        email,
        createdAt: new Date().toISOString(),
      };
      const nextAccounts = [...accounts, newAccount];
      await writeAccounts(nextAccounts);
      accounts = nextAccounts;
      return newAccount;
    });

    sendJson(response, 201, { account: publicAccount(account) });
  } catch (error) {
    const status = error.status || 500;
    sendJson(response, status, {
      error: error.status ? error.message : "Unable to process account request.",
    });
  }
}

async function handleRequest(request, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad Request");
    return;
  }

  if (pathname.startsWith("/api/")) {
    await handleAccountApi(request, response, pathname);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method Not Allowed");
    return;
  }

  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(root, `.${requestedPath}`);
  const relativePath = path.relative(root, filePath);
  const isHiddenPath = relativePath.split(path.sep).some((segment) => segment.startsWith("."));

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath) ||
    isHiddenPath
  ) {
    response.writeHead(404);
    response.end("Not Found");
    return;
  }

  try {
    const contents = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(request.method === "HEAD" ? undefined : contents);
  } catch {
    response.writeHead(404);
    response.end("Not Found");
  }
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch(() => {
    if (!response.headersSent) {
      sendJson(response, 500, { error: "Internal server error." });
    } else {
      response.destroy();
    }
  });
});

const port = Number(process.env.PORT) || 3000;

loadAccounts()
  .then((loadedAccounts) => {
    accounts = loadedAccounts;
    server.listen(port, "127.0.0.1", () => {
      console.log(`Deloitte-bot is available at http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Unable to load accounts:", error.message);
    process.exitCode = 1;
  });