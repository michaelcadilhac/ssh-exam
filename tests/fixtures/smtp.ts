import { createServer } from "node:net";
export async function smtpFixture(path: string) {
  const messages: string[] = [];
  let reject = false;
  const server = createServer((socket) => {
    socket.write("220 fixture SMTP\r\n");
    let input = "",
      body = "",
      data = false;
    socket.on("data", (bytes) => {
      input += bytes.toString();
      while (input.includes("\r\n")) {
        const end = input.indexOf("\r\n"),
          line = input.slice(0, end);
        input = input.slice(end + 2);
        if (data && line !== ".") {
          body += line + "\r\n";
          continue;
        }
        if (data) {
          messages.push(body);
          body = "";
          data = false;
          socket.write("250 accepted\r\n");
        } else if (line.startsWith("EHLO")) socket.write("250 fixture\r\n");
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
  await new Promise<void>((resolve) => server.listen(path, resolve));
  return {
    messages,
    reject(value: boolean) {
      reject = value;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
