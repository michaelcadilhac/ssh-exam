import sharp from "sharp";
import { createApp } from "../../apps/server/src/app.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";

// Synthetic data only. No SSH connection, account or installed service is used.
export async function mediaFixture(dir: string) {
  const running = await createApp({
    mode: "development",
    origin: "http://127.0.0.1",
    data: dir,
    port: 0,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["0".repeat(64)] },
    agent: {
      id: "class",
      signingKey: "/missing",
      callbackPublicKey: "/missing",
    },
    maintenance: false,
  });
  try {
    running.store.db.exec(
      "INSERT INTO exams VALUES('e','{}'); INSERT INTO attempts(id,exam,username,uid,state,settings,ended) VALUES('a','e','synthetic',1001,'COMPLETED','{\"webcam\":false}'," +
        Date.now() +
        ")",
    );
    const data = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    const frame = await new Monitoring(running.store).frame(
      running.store.attempt("a"),
      {
        source: "screen",
        seq: 1,
        captured: Date.now(),
        monotonic: 1,
        data: data.toString("base64"),
      },
      "page",
    );
    const session = running.store.session("admin", "teacher", null);
    return {
      ...running,
      data,
      frame,
      url: `/api/admin/media/${frame.id}`,
      headers: { cookie: `session=${session.token}` },
      path: `${dir}/monitoring/a/${frame.id}.jpg`,
      thumbnail: `${dir}/monitoring/a/${frame.id}.thumb.jpg`,
    };
  } catch (error) {
    await running.app.close();
    throw error;
  }
}
