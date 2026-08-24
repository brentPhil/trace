/*
 * The upload POST, with a progress event.
 *
 * WHY NOT `fetch`. `fetch` resolves when the request body has finished going
 * out; it exposes nothing while it is going. A 250 MiB track on a slow
 * connection is therefore a completely silent stretch of many minutes, which
 * is what the page did before this file existed — and the case only got
 * starker when the per-track cap went from 20 MiB to 250. `XMLHttpRequest`'s
 * `upload` emits `progress`, and that single capability is the whole reason
 * for the older API here.
 *
 * Everything else is carried over unchanged from the `fetch` this replaces,
 * including the two decisions that are easy to get wrong — see below.
 */

/** Thrown when the POST itself failed. The page maps this through
 *  `errorMessage`, which supplies the generic "That didn't save." line —
 *  the same sentence the `fetch` version produced. */
export class UploadFailed extends Error {}

export function postFileWithProgress(
  url: string,
  file: File,
  onProgress: (sent: number, total: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", url)

    // OMITTED ENTIRELY when the OS gave the file no type, never sent empty. An
    // empty `Content-Type` is a header CLAIMING a type of "", which Convex then
    // records as the blob's type and `isAcceptedAudioContentType` rejects. With
    // no header at all, `addTrackAction` falls through to the blob's own
    // sniffed type, which is the answer that can be right.
    if (file.type !== "") xhr.setRequestHeader("Content-Type", file.type)

    xhr.upload.onprogress = (event: ProgressEvent) => {
      // `lengthComputable` is false for a request whose length the browser will
      // not commit to. Reporting `event.total` then would draw a bar against a
      // denominator of zero; `file.size` is the number we already know.
      onProgress(event.loaded, event.lengthComputable ? event.total : file.size)
    }

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new UploadFailed(`upload failed with ${xhr.status}`))
        return
      }
      let payload: unknown
      try {
        payload = JSON.parse(xhr.responseText)
      } catch {
        reject(new UploadFailed("upload returned no id"))
        return
      }
      // Narrowed before `storageId` is read, so a changed response shape fails
      // loudly here rather than sending `undefined` on to the action.
      const storageId =
        typeof payload === "object" &&
        payload !== null &&
        "storageId" in payload &&
        typeof payload.storageId === "string"
          ? payload.storageId
          : null
      if (storageId === null) {
        reject(new UploadFailed("upload returned no id"))
        return
      }
      resolve(storageId)
    }

    xhr.onerror = () => reject(new UploadFailed("upload failed"))
    xhr.onabort = () => reject(new UploadFailed("upload cancelled"))

    xhr.send(file)
  })
}
