// Run with: npm test. 12-per-page lists and listing photo helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { paginate, pageWindow, PER_PAGE } from "../app/_ui/ui";
import { isPhotoFolderLink, listingPhotos, move, photoUrl, removedStoragePaths } from "./listing-photos";

const items = Array.from({ length: 30 }, (_, i) => i + 1);

test("paginate: 12 per page, clamped, with offsets for numbering", () => {
  assert.equal(PER_PAGE, 12);
  const p1 = paginate(items, undefined);
  assert.deepEqual([p1.page, p1.pages, p1.offset, p1.items.length, p1.items[0]], [1, 3, 0, 12, 1]);
  const p3 = paginate(items, "3");
  assert.deepEqual([p3.page, p3.offset, p3.items], [3, 24, [25, 26, 27, 28, 29, 30]]);
  assert.equal(paginate(items, "99").page, 3, "past the end -> last page");
  assert.equal(paginate(items, "-4").page, 1);
  assert.equal(paginate(items, "abc").page, 1);
  const empty = paginate([], "2");
  assert.deepEqual([empty.page, empty.pages, empty.items.length], [1, 1, 0]);
});

test("pageWindow shows first, last, current and neighbours", () => {
  assert.deepEqual(pageWindow(1, 1), [1]);
  assert.deepEqual(pageWindow(1, 3), [1, 2, 3]);
  assert.deepEqual(pageWindow(5, 33), [1, "…", 4, 5, 6, "…", 33]);
  assert.deepEqual(pageWindow(33, 33), [1, "…", 32, 33]);
  assert.deepEqual(pageWindow(2, 5), [1, 2, 3, 4, 5], "one missing page is shown, not '…'");
  assert.deepEqual(pageWindow(1, 4), [1, 2, 3, 4]);
  assert.deepEqual(pageWindow(1, 6), [1, 2, "…", 6]);
});

test("photo URLs: storage paths become public links, outside links stay as they are", () => {
  assert.equal(
    photoUrl("t1/l1/a b.jpg", "https://xyz.supabase.co/"),
    "https://xyz.supabase.co/storage/v1/object/public/listing-photos/t1/l1/a%20b.jpg"
  );
  assert.equal(photoUrl("https://cdn.test/x.jpg", "https://xyz.supabase.co"), "https://cdn.test/x.jpg");
  assert.deepEqual(listingPhotos({ photos: [], image_url: "https://old.test/p.jpg" }), ["https://old.test/p.jpg"]);
  assert.deepEqual(listingPhotos({ photos: null, image_url: null }), []);
});

test("only removed storage files are deleted, never outside links", () => {
  assert.deepEqual(removedStoragePaths(["t/l/a.jpg", "t/l/b.jpg", "https://x.test/c.jpg"], ["t/l/b.jpg"]), ["t/l/a.jpg"]);
  assert.deepEqual(removedStoragePaths(["t/l/a.jpg"], ["t/l/a.jpg"]), []);
});

test("move reorders photos (cover = first)", () => {
  assert.deepEqual(move(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  assert.deepEqual(move(["a", "b", "c"], 0, 1), ["b", "a", "c"]);
  assert.deepEqual(move(["a", "b"], 0, -1), ["a", "b"]);
});

test("photo folder links are recognised", () => {
  assert.equal(isPhotoFolderLink("https://drive.google.com/drive/folders/1Lvp?usp=sharing"), true);
  assert.equal(isPhotoFolderLink("https://www.dropbox.com/sh/abc/xyz"), true);
  assert.equal(isPhotoFolderLink("https://agency.test/listing/1"), false);
  assert.equal(isPhotoFolderLink(null), false);
});
