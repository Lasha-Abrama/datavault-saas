export function uniqueUploadFiles(entries, selected) {
  const key = (file) =>
    JSON.stringify([file.name, file.size, file.lastModified]);
  const seen = new Set(entries.map((entry) => key(entry.file)));
  return Array.from(selected || []).filter((file) => {
    const id = key(file);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

// A lost response or server error can follow a committed upload.
export function isUploadUncertain(error, signal) {
  return signal.aborted || !(error.status >= 400 && error.status < 500);
}
