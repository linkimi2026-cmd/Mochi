import type { Session, WebContents } from "electron";

type MediaKind = "microphone" | "camera";
type MediaAccess = {
  granted(kind: MediaKind): boolean;
  request(kind: MediaKind): Promise<boolean>;
};

/** Only the active, authenticated Mochi main document may acquire audio or video. */
export function installMicrophonePermissions(
  session: Pick<Session, "setPermissionCheckHandler" | "setPermissionRequestHandler">,
  current: () => WebContents | undefined,
  trustedUrl: (url: string) => boolean,
  access: MediaAccess,
): void {
  const owned = (contents: WebContents | null, mainFrame: boolean, url: string) =>
    contents !== null && contents === current() && !contents.isDestroyed()
    && mainFrame && trustedUrl(url) && trustedUrl(contents.getURL());

  session.setPermissionCheckHandler((contents, permission, origin, details) => {
    if (permission !== "media") return true;
    const kind = details.mediaType === "audio" ? "microphone" : details.mediaType === "video" ? "camera" : undefined;
    return kind !== undefined && owned(contents, details.isMainFrame, origin) && access.granted(kind);
  });
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (permission !== "media") { callback(true); return; }
    const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined;
    const kind = mediaTypes?.length === 1
      ? mediaTypes[0] === "audio" ? "microphone" : mediaTypes[0] === "video" ? "camera" : undefined
      : undefined;
    const allowed = () => kind !== undefined && owned(contents, details.isMainFrame, details.requestingUrl);
    if (!allowed()) { callback(false); return; }
    // A window may navigate or close while the OS authorization sheet is open.
    void access.request(kind!).then(granted => callback(granted && allowed()), () => callback(false));
  });
}
