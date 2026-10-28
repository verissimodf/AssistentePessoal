import net from "node:net";
import { lstatSync, unlinkSync } from "node:fs";

/** Remove apenas sockets Unix obsoletos; recusa um socket ativo ou um arquivo substituto. */
export async function removeStaleUnixSocket(socketPath) {
  let stat;
  try {
    stat = lstatSync(socketPath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw new Error("unix_socket_unavailable");
  }
  if (!stat.isSocket()) throw new Error("unix_socket_path_not_socket");

  const active = await new Promise((resolve) => {
    const socket = net.createConnection({ path: socketPath });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(true);
    }, 250);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      resolve(error?.code !== "ECONNREFUSED" && error?.code !== "ENOENT");
    });
  });
  if (active) throw new Error("unix_socket_in_use");
  try {
    unlinkSync(socketPath);
    return true;
  } catch {
    throw new Error("unix_socket_cleanup_failed");
  }
}
