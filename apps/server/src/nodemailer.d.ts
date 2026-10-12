declare module "nodemailer" {
  interface Transport {
    sendMail(message: {
      from: string;
      to: string[];
      subject: string;
      text: string;
    }): Promise<unknown>;
  }
  const nodemailer: {
    createTransport(options: {
      host: string;
      port: number;
      secure: boolean;
      requireTLS?: boolean;
      auth?: { user: string; pass: string };
    }): Transport;
  };
  export default nodemailer;
}
