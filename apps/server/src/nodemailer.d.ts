declare module "nodemailer" {
  interface Transport {
    close(): void;
    sendMail(message: {
      from: string;
      to: string[];
      subject: string;
      text: string;
        messageId?: string;
    }): Promise<unknown>;
  }
  const nodemailer: {
    createTransport(options: {
      host?: string;
      port?: number;
      secure?: boolean;
      requireTLS?: boolean;
      ignoreTLS?: boolean;
      connectionTimeout?: number;
      greetingTimeout?: number;
      socketTimeout?: number;
      getSocket?: (
        options: unknown,
        callback: (
          error: Error | null,
          result?: { connection: import("node:net").Socket },
        ) => void,
      ) => void;
      auth?: { user: string; pass: string };
    }): Transport;
  };
  export default nodemailer;
}
