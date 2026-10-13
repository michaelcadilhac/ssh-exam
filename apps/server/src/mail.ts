import { readFileSync } from "node:fs";
import { connect } from "node:net";
import nodemailer from "nodemailer";
import type { Config } from "../../../packages/config/index.js";

export function mailTransport(smtp: NonNullable<Config["smtp"]>) {
  const timeouts = {
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  };
  if ("socket" in smtp) {
    return nodemailer.createTransport({
      ...timeouts,
      secure: false,
      ignoreTLS: true, // Administrator-mounted local IPC; TCP always requires TLS.
      getSocket: (_options, callback) => {
        const socket = connect(smtp.socket);
        const timer = setTimeout(
          () => socket.destroy(Error("Local SMTP connection timed out")),
          timeouts.connectionTimeout,
        );
        const failed = (error: Error) => {
          clearTimeout(timer);
          callback(error);
        };
        socket.once("error", failed);
        socket.once("connect", () => {
          clearTimeout(timer);
          socket.off("error", failed);
          callback(null, { connection: socket });
        });
      },
    });
  }
  return nodemailer.createTransport({
    ...timeouts,
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: !smtp.secure,
    auth: smtp.user
      ? {
          user: smtp.user,
          pass: smtp.passwordFile
            ? readFileSync(smtp.passwordFile, "utf8").trim()
            : "",
        }
      : undefined,
  });
}
