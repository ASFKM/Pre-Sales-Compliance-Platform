// CloudMountain Diagnostics Agent (CDA), frontend - captures exactly one frame, never a recording,
// and only ever runs from an explicit user action (the caller in BugReportModal.tsx only invokes
// this after the user both checks the "incluir captura de tela" box AND clicks enviar).
// getDisplayMedia() itself forces the browser's own native screen/window/tab picker - a second,
// OS-level consent layer this code cannot bypass even if it wanted to (briefing Seção 17: "não
// tirar screenshot escondido").
export async function captureScreenshot(): Promise<Blob> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  try {
    const track = stream.getVideoTracks()[0];
    const video = document.createElement("video");
    video.srcObject = stream;
    await video.play();

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.drawImage(video, 0, 0);

    track.stop();

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Failed to encode screenshot"))), "image/png");
    });
  } finally {
    // Belt and braces - stop every track even if something above threw before reaching track.stop().
    stream.getTracks().forEach((t) => t.stop());
  }
}
