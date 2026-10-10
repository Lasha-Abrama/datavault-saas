import { test } from "node:test";
import assert from "node:assert/strict";
import { uniqueUploadFiles, isUploadUncertain } from "../lib/upload-safety.mjs";

const file = (name = "data.csv") => ({ name, size: 7, lastModified: 1 });

test("selection deduplicates within a pick and across all queue states", () => {
  const csv = file();
  assert.deepEqual(uniqueUploadFiles([], [csv, csv]), [csv]);
  for (const status of ["ready", "failed", "success", "uncertain"])
    assert.deepEqual(uniqueUploadFiles([{ file: csv, status }], [csv]), []);
  assert.equal(
    uniqueUploadFiles([{ file: csv }], [file("other.csv")]).length,
    1,
  );
  assert.equal(
    uniqueUploadFiles([{ file: csv }], [{ ...csv, lastModified: 2 }]).length,
    1,
  );
  assert.deepEqual(uniqueUploadFiles([], null), []);
});

for (const status of [0, 500, 503, 504, undefined]) {
  test(`${status} response has an uncertain upload outcome`, () => {
    assert.equal(
      isUploadUncertain({ status }, new AbortController().signal),
      true,
    );
  });
}

test("explicit rejections are retryable unless the request was cancelled", () => {
  const controller = new AbortController();
  for (const status of [400, 401, 403, 413, 429])
    assert.equal(isUploadUncertain({ status }, controller.signal), false);
  controller.abort();
  assert.equal(isUploadUncertain({ status: 400 }, controller.signal), true);
});
