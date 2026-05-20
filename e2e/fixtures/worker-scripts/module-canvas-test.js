// Module worker test script — served over HTTP so Duppel can wrap it
// via await import("http://...") instead of import("blob:...") which fails.
self.onmessage = function() {
  var oc = new OffscreenCanvas(50, 10);
  var ctx = oc.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 50, 10);
  var id = ctx.getImageData(0, 0, 50, 10);
  var diffCount = 0;
  for (var i = 0; i < id.data.length; i += 4) {
    if (id.data[i] !== 128 || id.data[i+1] !== 128 || id.data[i+2] !== 128) {
      diffCount++;
    }
  }
  self.postMessage({
    diffCount: diffCount,
    total: id.data.length / 4,
    pixels: Array.from(id.data.slice(0, 40))
  });
};
