import assert from "node:assert/strict";
import { fitKartutsnitt, projectGarasjePunkt, unprojectGarasjePunkt } from "../apps/demo-gui/src/client/garasje-kart.ts";
import type { GarasjePolygon } from "../apps/shared/garasje.ts";

const center = { lat: 60.2536577976675, lon: 5.255241147052527 };
const polygon: GarasjePolygon = {
  id: "259953783",
  ringer: [[[5.2555238, 60.2536782], [5.255341, 60.2535286], [5.2550217, 60.253501],
    [5.2548037, 60.2536077], [5.2552815, 60.2538992], [5.2555238, 60.2536782]]]
};
const rectangles: GarasjePolygon[] = [polygon, {
  id: "lang-teig",
  ringer: [[[5.25, 60.25], [5.26, 60.25], [5.26, 60.2501], [5.25, 60.2501], [5.25, 60.25]]]
}];
for (const polygons of [[polygon], rectangles, []]) {
  const bounds = fitKartutsnitt(polygons, center);
  const lonMeters = 111320 * Math.cos(center.lat * Math.PI / 180);
  const width = (bounds.east - bounds.west) * lonMeters;
  const height = (bounds.north - bounds.south) * 111320;
  assert(Math.abs(width / height - 4 / 3) < 1e-8, "Kartet må ha samme proporsjoner som SVG-flaten");
  for (const shape of polygons) {
    for (const ring of shape.ringer) {
      for (const [lon, lat] of ring) {
        assert((lon - bounds.west) * lonMeters > 9.99);
        assert((bounds.east - lon) * lonMeters > 9.99);
        assert((lat - bounds.south) * 111320 > 9.99);
        assert((bounds.north - lat) * 111320 > 9.99);
      }
    }
  }
  const [x, y] = projectGarasjePunkt(center, bounds);
  const restored = unprojectGarasjePunkt(x / 640, y / 480, bounds);
  assert(Math.abs(restored.lat - center.lat) < 1e-10);
  assert(Math.abs(restored.lon - center.lon) < 1e-10);
  assert.deepEqual(unprojectGarasjePunkt(-1, -1, bounds), { lon: bounds.west, lat: bounds.north });
  assert.deepEqual(unprojectGarasjePunkt(2, 2, bounds), { lon: bounds.east, lat: bounds.south });
}
console.log("Garasjekart: tomteutsnitt med minst ti meter marg, proporsjoner og markørplassering besto.");
