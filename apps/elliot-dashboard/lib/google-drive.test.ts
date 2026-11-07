// Run with: npm test. Google Drive folder links -> listing photos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { driveFolderId, driveImageUrl, isDriveImageUrl, mergeDrivePhotos, resizedPhotoUrl } from "./google-drive";

test("folder ids from every common link shape", () => {
  assert.equal(driveFolderId("https://drive.google.com/drive/folders/1LvpezMp3EambrnvLf1ah3MMYhHCgcqCx?usp=sharing"), "1LvpezMp3EambrnvLf1ah3MMYhHCgcqCx");
  assert.equal(driveFolderId("https://drive.google.com/drive/folders/1Ee5QLbClIdZDm9wjV3mLU0NKaI1q4jI6?usp=drive_link"), "1Ee5QLbClIdZDm9wjV3mLU0NKaI1q4jI6");
  assert.equal(driveFolderId("https://drive.google.com/drive/u/1/folders/1abcDEFghiJKL"), "1abcDEFghiJKL");
  assert.equal(driveFolderId("https://drive.google.com/open?id=1abcDEFghiJKL"), "1abcDEFghiJKL");
  assert.equal(driveFolderId("https://drive.google.com/file/d/1abcDEFghiJKL/view"), null, "a single file is not a folder");
  assert.equal(driveFolderId("https://agency.test/listing/1"), null);
  assert.equal(driveFolderId(null), null);
});

test("image links and resizing", () => {
  const url = driveImageUrl("FILE123");
  assert.equal(url, "https://drive.google.com/thumbnail?id=FILE123&sz=w1600");
  assert.ok(isDriveImageUrl(url));
  assert.equal(resizedPhotoUrl(url, 320), "https://drive.google.com/thumbnail?id=FILE123&sz=w320");
  assert.equal(resizedPhotoUrl("https://cdn.test/a.jpg", 320), "https://cdn.test/a.jpg");
  assert.equal(isDriveImageUrl("t1/l1/a.jpg"), false);
});

test("merging keeps the agency's own photos first and replaces old Drive photos", () => {
  const own = ["t/l/cover.jpg", "https://cdn.test/x.jpg"];
  const oldDrive = driveImageUrl("OLD");
  const fresh = [driveImageUrl("A"), driveImageUrl("B")];
  assert.deepEqual(mergeDrivePhotos([...own, oldDrive], fresh), [...own, ...fresh]);
  assert.deepEqual(mergeDrivePhotos([], fresh), fresh);
  assert.equal(mergeDrivePhotos([], Array.from({ length: 30 }, (_, i) => driveImageUrl(String(i)))).length, 20, "max 20");
});
