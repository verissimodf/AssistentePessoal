import http from "node:http";

const MAX_RESPONSE_BYTES = 256 * 1024;

/** Request the managed browser worker through its private Unix socket only. */
export function requestBrowserWorker(
  payload,
  { socketPath = process.env.JARVIS_BROWSER_WORKER_SOCKET, path = "/run", signal } = {},
) {
  if (!socketPath) return Promise.reject(new Error("browser_worker_socket_unavailable"));
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath, path, method: "POST", headers: { "content-type": "application/json" }, signal },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy(new Error("browser_worker_response_too_large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            if (res.statusCode !== 200) throw new Error("browser_worker_unavailable");
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new Error("browser_worker_protocol_error"));
          }
        });
      },
    );
    req.once("error", () => reject(new Error("browser_worker_unavailable")));
    req.end(JSON.stringify(payload));
  });
}
