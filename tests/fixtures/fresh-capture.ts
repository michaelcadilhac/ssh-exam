import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { expect } from "vitest";
import type { DisplayObservation } from "../../packages/protocol/display-policy.js";

// Real authenticated challenge and JPEG interfaces, not a seeded freshness row.
export async function freshCapture(
  app: FastifyInstance,
  id: string,
  page: string,
  headers: Record<string, string>,
  webcam = false,
  display?: DisplayObservation,
) {
  const data = (
    await sharp({
      create: { width: 40, height: 30, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer()
  ).toString("base64");
  for (const source of webcam ? ["screen", "webcam"] : ["screen"]) {
    const requestHeaders = { ...headers, "x-page-instance": page },
      url = `/api/student/attempts/${id}`;
    const challenge = await app.inject({
      method: "POST",
      url: url + "/capture-challenges",
      headers: requestHeaders,
      payload: { source },
    });
    expect(challenge.statusCode, challenge.body).toBe(200);
    const ticket = challenge.json();
    const upload = await app.inject({
      method: "POST",
      url: url + "/frames/challenged",
      headers: requestHeaders,
      payload: {
        source,
        seq: ticket.after_sequence + 1,
        captured: Date.now(),
        monotonic: 1,
        data,
        challenge: ticket.challenge,
        readiness: {
          fullscreen: true,
          visible: true,
          focus: true,
          keyboard: true,
          screen: true,
          webcam,
          ...(display ? { display } : {}),
        },
      },
    });
    expect(upload.statusCode, upload.body).toBe(200);
  }
}
