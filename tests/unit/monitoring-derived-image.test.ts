import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Store, hash } from "../../apps/server/src/db.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import { MonitoringManagement } from "../../apps/server/src/monitoring-management.js";

const frame = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const provenance = {
  encoding: "vp9-webm-v1" as const,
  capture_sha256: hash("original capture"),
  capture_width: 40,
  capture_height: 30,
  segment: "11111111-1111-4111-8111-111111111111",
  segment_sha256: hash("verified segment"),
  index: 3,
  decoded_sha256: hash("packed full-frame RGB24"),
};

function fixture(change?: (image: any) => void) {
  const store = new Store(mkdtempSync(tmpdir() + "/derived-image-response-"));
  const monitoring = new Monitoring(store);
  store.db.exec(
    "INSERT INTO exams VALUES('e','{}'); INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,ended,protected,access_state,checksum) VALUES('a','e','synthetic',10001,'COMPLETED','{}',1,2,2,2,1,'RELEASED','protected-history')",
  );
  store.db
    .prepare(
      "INSERT INTO frames(id,attempt,source,seq,page_hash,captured,monotonic,received,width,height,hash) VALUES(?,'a','screen',1,'synthetic',1,1.5,2,40,30,?)",
    )
    .run(frame, provenance.capture_sha256);
  const before = store.attempt("a");
  // This fixture isolates the management JSON boundary. Actual decoding,
  // provenance verification and filesystem safety are separate media tests.
  const media = {
    async read(_frame: string, thumbnail: boolean) {
      const image: any = {
        id: frame,
        attempt: "a",
        thumbnail,
        data: Buffer.from(
          thumbnail ? "derived thumbnail" : "derived review JPEG",
        ),
        provenance: { ...provenance },
        ...(!thumbnail ? { width: 20, height: 16 } : {}),
      };
      change?.(image);
      return image;
    },
  };
  const management = new MonitoringManagement(store, monitoring, media as any);
  return {
    async image(thumbnail: boolean) {
      const body = { id: "a", frame, thumbnail };
      return management.image(
        body,
        management.receipt("monitoring.image", body),
        "synthetic-instructor",
      );
    },
    close() {
      expect(store.attempt("a")).toEqual(before);
      expect(
        store.db
          .prepare("SELECT hash,width,height,captured FROM frames WHERE id=?")
          .get(frame),
      ).toEqual({
        hash: provenance.capture_sha256,
        width: 40,
        height: 30,
        captured: 1,
      });
      store.close();
      rmSync(store.dir, { recursive: true, force: true });
    },
  };
}

it("forwards video-derived image provenance and review dimensions while preserving original capture metadata", async () => {
  const f = fixture();
  try {
    const image = await f.image(false);
    expect(image).toMatchObject({
      id: "a",
      frame,
      thumbnail: false,
      format: "jpeg",
      width: 20,
      height: 16,
      provenance,
      sha256: hash("derived review JPEG"),
    });
    expect(image.sha256).not.toBe(provenance.capture_sha256);
    const thumbnail = await f.image(true);
    expect(thumbnail.provenance).toEqual(provenance);
    expect(thumbnail).not.toHaveProperty("width");
    expect(thumbnail).not.toHaveProperty("height");
    expect(thumbnail.sha256).toBe(hash("derived thumbnail"));
  } finally {
    f.close();
  }
});

it.each([
  (image: any) => {
    image.provenance.path = "/private";
  },
  (image: any) => {
    image.provenance.capture_sha256 = hash("different capture");
  },
  (image: any) => {
    image.width = undefined;
  },
])(
  "refuses malformed derived image metadata before returning management bytes",
  async (change) => {
    const f = fixture(change);
    try {
      await expect(f.image(false)).rejects.toMatchObject({
        reason: "storage",
        statusCode: 503,
      });
    } finally {
      f.close();
    }
  },
);
