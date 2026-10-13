import { expect, it } from "vitest";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { mailTransport } from "../../apps/server/src/mail.js";
import { loadConfig } from "../../packages/config/index.js";

it("delivers over a private local SMTP socket with configurable recipients", async () => {
  const dir = mkdtempSync(tmpdir() + "/exam-mail-");
  const commands: string[] = [];
  const messages: string[] = [];
  let reject = true;
  const server = createServer((socket) => {
    socket.write("220 local SMTP\r\n");
    let buffer = "",
      body = "",
      data = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      while (buffer.includes("\r\n")) {
        const end = buffer.indexOf("\r\n"),
          line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data && line !== ".") {
          body += line + "\r\n";
          continue;
        }
        if (data) {
          messages.push(body);
          body = "";
          data = false;
          socket.write("250 accepted\r\n");
          continue;
        }
        commands.push(line);
        if (line.startsWith("EHLO"))
          socket.write("250-local\r\n250 STARTTLS\r\n");
        else if (line === "DATA") {
          if (reject) socket.write("451 temporarily unavailable\r\n");
          else {
            data = true;
            socket.write("354 continue\r\n");
          }
        } else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(dir + "/smtp.sock", resolve),
  );
  const smtp = {
    socket: dir + "/smtp.sock",
    from: "exam@example.edu",
    to: ["instructor@example.edu"],
  };
  const message = {
    from: smtp.from,
    to: smtp.to,
    subject: "Collection alert",
    text: "Protected-copy transfer pending",
  };
  try {
    let transport = mailTransport(smtp);
    await expect(transport.sendMail(message)).rejects.toThrow();
    transport.close();
    reject = false;
    transport = mailTransport(smtp);
    await transport.sendMail(message);
    transport.close();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("instructor@example.edu");
    expect(messages[0]).toContain("Protected-copy transfer pending");
    expect(commands.some((c) => c.startsWith("AUTH") || c === "STARTTLS")).toBe(
      false,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

it("rejects relative SMTP socket paths in deployment configuration", () => {
  const dir = mkdtempSync(tmpdir() + "/exam-mail-config-");
  writeFileSync(
    dir + "/config.json",
    JSON.stringify({
      mode: "development",
      origin: "http://localhost:3000",
      jump: { host: "localhost", pins: ["0".repeat(64)] },
      class: { host: "localhost", pins: ["0".repeat(64)] },
      agent: { id: "class", signingKey: "test", callbackPublicKey: "test" },
      smtp: {
        socket: "relative.sock",
        from: "exam@example.edu",
        to: ["instructor@example.edu"],
      },
    }),
  );
  try {
    expect(() => loadConfig(dir + "/config.json")).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
