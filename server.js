const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = __dirname;
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method Not Allowed");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad Request");
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
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, "127.0.0.1", () => {
  console.log(`Deloitte-bot is available at http://localhost:${port}`);
});