function trustedSender(event, window, origin) {
  return Boolean(window && !window.isDestroyed() && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame && event.senderFrame?.origin === origin)
}
function applicationNavigation(url, origin) {
  try { return new URL(url).origin === origin } catch { return false }
}
function permissionAllowed(window, webContents, origin, permission, details) {
  if (!window || window.isDestroyed() || webContents !== window.webContents || !details?.isMainFrame) return false
  if (origin !== window.webContents.mainFrame.origin) return false
  if (permission === "clipboard-sanitized-write") return true
  return permission === "media" && details.mediaType === "audio"
}
function permissionRequestAllowed(window, webContents, origin, permission, details) {
  if (!applicationNavigation(details?.requestingUrl, origin)) return false
  const mediaTypes = details.mediaTypes
  const mediaType = mediaTypes?.length && mediaTypes.every(type => type === "audio") ? "audio" : "unknown"
  return permissionAllowed(window, webContents, origin, permission, { ...details, mediaType })
}
module.exports = { trustedSender, applicationNavigation, permissionAllowed, permissionRequestAllowed }
