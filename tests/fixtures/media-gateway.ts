import { mediaFixture } from "./monitoring-media.js";

// Owned test child: a synchronous FIFO regression must never wedge Vitest itself.
const fixture = await mediaFixture(process.argv[2]);
const origin = await fixture.app.listen({ host: "127.0.0.1", port: 0 });
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await fixture.app.close();
  process.exit(0);
};
process.once("disconnect", close);
process.once("SIGTERM", close);
setTimeout(close, 20000).unref();
process.send?.({
  origin,
  url: fixture.url,
  headers: fixture.headers,
  path: fixture.path,
  thumbnail: fixture.thumbnail,
});
