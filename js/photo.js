/**
 * Client-side photo compression (ASM-004 / REQ-019): resize to a max of
 * ~1600px on the longest edge and re-encode as JPEG at ~0.7 quality before
 * the photo is queued offline or sent, to keep offline storage manageable.
 */
(function (global) {
  const MAX_EDGE = 1600;
  const JPEG_QUALITY = 0.7;

  function readFileAsImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }

  async function compressPhoto(file) {
    const img = await readFileAsImage(file);
    let { width, height } = img;

    if (width > height && width > MAX_EDGE) {
      height = Math.round((height * MAX_EDGE) / width);
      width = MAX_EDGE;
    } else if (height >= width && height > MAX_EDGE) {
      width = Math.round((width * MAX_EDGE) / height);
      height = MAX_EDGE;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);

    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return { dataUrl, width, height, approxBytes: Math.round((dataUrl.length * 3) / 4) };
  }

  global.PhotoUtil = { compressPhoto };
})(window);
