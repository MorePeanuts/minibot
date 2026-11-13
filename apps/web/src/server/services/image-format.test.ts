import { expect, it } from "vitest";
import { imageMediaType } from "./image-format";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ZkAAAAASUVORK5CYII=",
  "base64",
);

it.each([
  ["image/png", png],
  ["image/gif", Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")],
])("recognizes supported image bytes", (mime, bytes) => {
  expect(imageMediaType(bytes)).toBe(mime);
});

it("rejects HTML, SVG and incomplete image headers", () => {
  expect(imageMediaType(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
  expect(imageMediaType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  expect(imageMediaType(png.subarray(0, 16))).toBeNull();
});
